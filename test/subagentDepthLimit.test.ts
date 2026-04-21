/**
 * Spec 06 — Phase 4: validates that `spawn_subagent` enforces
 * `MAX_SUBAGENT_DEPTH`. The tool itself should return an error once the
 * parent loop's `agentDepth` has reached the ceiling.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '') } }));

import { resetRegistry, loadBuiltins, pluginApi, getTool } from '../electron/plugins/registry';
import {
  MAX_SUBAGENT_DEPTH,
  createSpawnSubagentTool,
  syncSpawnSubagentTool,
} from '../electron/plugins/subagent-tool';
import { initializeDatabase, setAppSetting } from '../electron/database';
import type { ToolContext, ToolPlugin } from '../electron/plugins/types';

describe('spawn_subagent — depth enforcement', () => {
  beforeEach(() => {
    resetRegistry();
    loadBuiltins();
  });

  it('returns error once parent depth >= MAX_SUBAGENT_DEPTH', async () => {
    const tool = createSpawnSubagentTool();
    const db = initializeDatabase(':memory:');
    try {
      const ctx: ToolContext = { db, agentDepth: MAX_SUBAGENT_DEPTH };
      const result = await tool.execute(null, { instruction: 'noop' }, ctx);
      expect(result).toEqual({ error: 'max subagent depth reached' });
    } finally {
      db.close();
    }
  });

  it('permits invocation at depth below the ceiling', async () => {
    const tool = createSpawnSubagentTool();
    const db = initializeDatabase(':memory:');
    try {
      // Stub `chatWithRole` by replacing the google provider's `chat` — but
      // simpler: monkey-patch the tool's dependency by providing a dummy
      // provider response via plugin override. For this test we only care
      // that the depth check passes and the executor role is resolved.
      // `chatWithRole` will ultimately call `getProviderForModel` and try to
      // hit fetch; we mock global.fetch so the call resolves deterministically.
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'done' }] } }],
        }),
      }) as any;
      db.prepare(`UPDATE ProviderConfigs SET googleKey = 'test', roles = '{"executor":{"model":"google/gemini-1.5-flash"}}' WHERE id = 1`).run();
      try {
        const ctx: ToolContext = { db, agentDepth: 0 };
        const result = await tool.execute(null, { instruction: 'say hi' }, ctx);
        expect(result).toHaveProperty('output');
        expect((result as any).output).toBe('done');
      } finally {
        global.fetch = originalFetch;
      }
    } finally {
      db.close();
    }
  });

  it('passes an incremented agentDepth to child tool invocations', async () => {
    const tool = createSpawnSubagentTool();
    const db = initializeDatabase(':memory:');
    try {
      db.prepare(`UPDATE ProviderConfigs SET googleKey = 'test', roles = '{"executor":{"model":"google/gemini-1.5-flash"}}' WHERE id = 1`).run();

      // Register a spy tool we can include in the allowlist.
      let observedDepth: number | undefined = undefined;
      const spyTool: ToolPlugin = {
        name: 'depth_probe',
        description: 'records the depth it was invoked at',
        parameters: { type: 'object', properties: {} },
        execute: async (_id, _args, ctx) => {
          observedDepth = ctx.agentDepth;
          return { ok: true };
        },
      };
      pluginApi.registerTool(spyTool);

      // First call returns a functionCall to `depth_probe`, second call
      // returns plain text so the loop terminates.
      const originalFetch = global.fetch;
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ functionCall: { name: 'depth_probe', args: {} } }] } }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'done' }] } }],
          }),
        });
      global.fetch = fetchMock as any;

      try {
        const ctx: ToolContext = { db, agentDepth: 0 };
        const result = await tool.execute(null, {
          instruction: 'probe',
          tools: ['depth_probe'],
        }, ctx);
        expect(result).toEqual({ output: 'done' });
        expect(observedDepth).toBe(1);
      } finally {
        global.fetch = originalFetch;
        pluginApi.unregisterTool('depth_probe');
      }
    } finally {
      db.close();
    }
  });
});

describe('spawn_subagent — registration flag', () => {
  beforeEach(() => {
    resetRegistry();
    loadBuiltins();
  });

  it('only registers the tool when AppSettings.enableSubagents = "true"', () => {
    const db = initializeDatabase(':memory:');
    try {
      syncSpawnSubagentTool(db);
      expect(getTool('spawn_subagent')).toBeUndefined();

      setAppSetting(db, 'enableSubagents', 'true');
      syncSpawnSubagentTool(db);
      expect(getTool('spawn_subagent')).toBeDefined();

      setAppSetting(db, 'enableSubagents', 'false');
      syncSpawnSubagentTool(db);
      expect(getTool('spawn_subagent')).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

