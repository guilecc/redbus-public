/**
 * Spec 06 — role resolver contract.
 *
 * Checks that `resolveRole` pulls per-role bindings from `ProviderConfigs.roles`
 * and falls back to sensible defaults when the JSON is missing or malformed.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '') } }));

import {
  DEFAULT_ROLES,
  parseRolesJson,
  serializeRolesJson,
  resolveRole,
  resolveThinkLevelForRole,
} from '../electron/services/roles';
import { resetRegistry, loadBuiltins, pluginApi } from '../electron/plugins/registry';
import { initializeDatabase } from '../electron/database';
import type { ProviderPlugin } from '../electron/plugins/types';

describe('parseRolesJson', () => {
  it('returns empty out map when input is empty', () => {
    const parsed = parseRolesJson('');
    expect(parsed).toEqual(DEFAULT_ROLES);
  });

  it('returns empty out map when input is malformed JSON', () => {
    const parsed = parseRolesJson('{not valid');
    expect(parsed).toEqual(DEFAULT_ROLES);
  });

  it('preserves valid roles while omitting unset ones', () => {
    const parsed = parseRolesJson(JSON.stringify({
      planner: { model: 'custom-model', thinkingLevel: 'high' },
    }));
    expect(parsed.planner?.model).toBe('custom-model');
    expect(parsed.planner?.thinkingLevel).toBe('high');
    expect(parsed.executor).toBeUndefined();
  });

  it('drops entries with non-string model', () => {
    const parsed = parseRolesJson(JSON.stringify({
      executor: { model: 42, thinkingLevel: 'off' },
    }));
    expect(parsed.executor).toBeUndefined();
  });

  it('preserves temperature when numeric', () => {
    const parsed = parseRolesJson(JSON.stringify({
      utility: { model: 'gemini-2.5-flash', temperature: 0.2 },
    }));
    expect(parsed.utility?.temperature).toBe(0.2);
  });
});

describe('serializeRolesJson round-trip', () => {
  it('parse(serialize(x)) === x', () => {
    const original = {
      planner: { model: 'o1', thinkingLevel: 'high' as const },
    };
    const parsed = parseRolesJson(serializeRolesJson(original));
    expect(parsed).toEqual(original);
  });
});

describe('resolveRole', () => {
  it('throws SetupRequiredError when the role is not configured in DB', () => {
    const db = initializeDatabase(':memory:');
    try {
      db.prepare(`UPDATE ProviderConfigs SET roles = '' WHERE id = 1`).run();
      expect(() => resolveRole(db, 'planner')).toThrow("Role 'planner' is not configured");
    } finally {
      db.close();
    }
  });

  it('reads overrides stored as JSON in ProviderConfigs.roles', () => {
    const db = initializeDatabase(':memory:');
    try {
      const custom = {
        synthesizer: { model: 'claude-3-5-sonnet-20241022', thinkingLevel: 'medium' as const },
      };
      db.prepare('UPDATE ProviderConfigs SET roles = ? WHERE id = 1').run(serializeRolesJson(custom));
      expect(resolveRole(db, 'synthesizer').model).toBe('claude-3-5-sonnet-20241022');
    } finally {
      db.close();
    }
  });
});

describe('resolveThinkLevelForRole', () => {
  it('returns undefined when the provider plugin has no thinking capability', () => {
    resetRegistry();
    loadBuiltins();
    // Register a provider that matches `mock/*` but advertises no thinking.
    const mockProvider: ProviderPlugin = {
      id: 'mock-nothink',
      label: 'Mock (no thinking)',
      matches: (m) => m.startsWith('mock/'),
      listModels: async () => [],
      chat: async () => ({ content: '' }),
    };
    pluginApi.registerProvider(mockProvider);
    const db = initializeDatabase(':memory:');
    try {
      const custom = {
        planner: { model: 'mock/no-thinking', thinkingLevel: 'high' as const },
      };
      db.prepare('UPDATE ProviderConfigs SET roles = ? WHERE id = 1').run(serializeRolesJson(custom));
      expect(resolveThinkLevelForRole(db, 'planner')).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('clamps to a supported level for capable providers', () => {
    resetRegistry();
    loadBuiltins();
    const db = initializeDatabase(':memory:');
    try {
      const custom = {
        planner: { model: 'claude-3-7-sonnet-20250219', thinkingLevel: 'high' as const },
      };
      db.prepare('UPDATE ProviderConfigs SET roles = ? WHERE id = 1').run(serializeRolesJson(custom));
      const level = resolveThinkLevelForRole(db, 'planner');
      expect(level).toBe('high');
    } finally {
      db.close();
    }
  });
});

