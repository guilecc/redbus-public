import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  safeStorage: null,
}));

import { resetRegistry, loadBuiltins, getProvider, getProviderForModel, listTools, pluginApi } from '../electron/plugins/registry';
import { registerForgeBuiltins } from '../electron/plugins/forge-tools';
import { setSkillsRoot, writeSkill, deleteSkill, reindexSkills } from '../electron/services/skillsLoader';
import { initializeDatabase } from '../electron/database';

// Ensure registry is isolated per-test suite.
beforeEach(() => {
  resetRegistry();
  loadBuiltins();
});

describe('plugin registry', () => {
  it('registers all built-in providers and routes models by prefix/substring', () => {
    expect(getProvider('anthropic')).toBeDefined();
    expect(getProvider('openai')).toBeDefined();
    expect(getProvider('google')).toBeDefined();
    expect(getProvider('ollama')).toBeDefined();
    expect(getProvider('ollama-cloud')).toBeDefined();

    expect(getProviderForModel('claude-3-5-haiku').id).toBe('anthropic');
    expect(getProviderForModel('gpt-4o-mini').id).toBe('openai');
    expect(getProviderForModel('gemini-2.5-flash').id).toBe('google');
    expect(getProviderForModel('ollama/llama3').id).toBe('ollama');
    expect(getProviderForModel('ollama-cloud/llama3').id).toBe('ollama-cloud');
  });
});

describe('provider plugins — chat', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; vi.clearAllMocks(); });

  it('anthropic plugin issues the expected request and strips markdown fences', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '```json\n{"a":1}\n```' }] }),
    });
    const provider = getProvider('anthropic')!;
    const result = await provider.chat({
      model: 'claude-3-5-haiku',
      configs: { anthropicKey: 'ant-key' },
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST' })
    );
    const call = (global.fetch as any).mock.calls[0][1];
    expect(call.headers['x-api-key']).toBe('ant-key');
    expect(JSON.parse(call.body).system).toBe('sys');
    expect(result.content).toBe('{"a":1}');
  });

  it('openai plugin wraps tools in the function envelope', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }] } }] }),
    });
    const provider = getProvider('openai')!;
    const result = await provider.chat({
      model: 'gpt-4o',
      configs: { openAiKey: 'sk' },
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object', properties: {} } }],
    });
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('t');
    expect(result.tool_calls?.[0].name).toBe('t');
  });

  it('google plugin formats tools as function_declarations and sets JSON mime', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }),
    });
    const provider = getProvider('google')!;
    const result = await provider.chat({
      model: 'gemini-2.5-flash',
      configs: { googleKey: 'gk' },
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: 'json_object',
    });
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toContain('gemini-2.5-flash:generateContent');
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(result.content).toBe('{"ok":1}');
  });

  it('ollama plugin posts to the OpenAI-compat endpoint and strips the prefix from the model', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    const provider = getProvider('ollama')!;
    const result = await provider.chat({
      model: 'ollama/llama3',
      configs: { ollamaUrl: 'http://localhost:11434' },
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.model).toBe('llama3');
    expect(result.content).toBe('ok');
  });
});

describe('forge-tools builtins', () => {
  let db: ReturnType<typeof initializeDatabase>;
  let tmpRoot: string;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redbus-plugins-test-'));
    setSkillsRoot(tmpRoot);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    setSkillsRoot(path.join(os.homedir(), '.redbus', 'skills'));
  });

  it('registers exec and read_file builtins', () => {
    registerForgeBuiltins(db);
    expect(listTools().map(t => t.name)).toContain('exec');
    expect(listTools().map(t => t.name)).toContain('read_file');
  });

  it('PluginApi.unregisterTool removes individual tools', () => {
    pluginApi.registerTool({ name: 'tmp_tool', description: 'd', parameters: {}, execute: async () => null });
    expect(listTools().map(t => t.name)).toContain('tmp_tool');
    pluginApi.unregisterTool('tmp_tool');
    expect(listTools().map(t => t.name)).not.toContain('tmp_tool');
  });
});

