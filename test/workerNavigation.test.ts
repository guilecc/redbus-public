import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runWorkerStep } from '../electron/services/llmService';

describe('LLM Service - Tool Calling', () => {

  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('1. Deve formatar corretamente ferramentas para OpenAI', async () => {
    const mockDb = {
      prepare: vi.fn(() => ({
        get: vi.fn().mockReturnValue({
          roles: JSON.stringify({ executor: { model: 'gpt-4o', thinkingLevel: 'off' } }),
          openAiKey: 'sk-test'
        })
      }))
    };

    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            tool_calls: [{
              id: 'call-1',
              function: { name: 'browser_snapshot', arguments: '{}' }
            }]
          }
        }]
      })
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const result = await runWorkerStep(mockDb, [{ role: 'user', content: 'test' }]);

    expect(result.tool_calls[0].name).toBe('browser_snapshot');
    expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({
      body: expect.stringContaining('function')
    }));
  });

  it('2. Deve formatar corretamente ferramentas para Anthropic', async () => {
    const mockDb = {
      prepare: vi.fn(() => ({
        get: vi.fn().mockReturnValue({
          roles: JSON.stringify({ executor: { model: 'claude-3-haiku', thinkingLevel: 'off' } }),
          anthropicKey: 'ant-test'
        })
      }))
    };

    const mockResponse = {
      ok: true,
      json: async () => ({
        content: [
          { type: 'tool_use', id: 'u1', name: 'browser_snapshot', input: {} }
        ]
      })
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const result = await runWorkerStep(mockDb, [{ role: 'user', content: 'test' }]);

    expect(result.tool_calls[0].name).toBe('browser_snapshot');
    expect(global.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      body: expect.stringContaining('input_schema')
    }));
  });
});
