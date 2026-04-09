import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractDataFromDOM } from '../electron/services/llmService';

describe('LLM Service - Worker Test', () => {

  const originalFetch = global.fetch;

  beforeEach(() => {
    // Mock global fetch for preventing real network requests
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('1. Deve extrair JSON via OpenAI REST API corretamente', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          workerModel: 'gpt-4o-mini',
          openAiKey: 'sk-test'
        })
      })
    };

    const mockFetchResponse = {
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: '{"result":"success open"}' } }
        ]
      })
    };

    (global.fetch as any).mockResolvedValue(mockFetchResponse);

    const result = await extractDataFromDOM(mockDb, '<html><body>This is a fake DOM with enough content to pass the minimum length guard for extraction testing purposes in the unit test suite.</body></html>', 'Extract fake param');
    expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.any(Object));
    expect(result).toBe('{"result":"success open"}');
  });

  it('2. Deve extrair JSON via Anthropic REST API corretamente', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          workerModel: 'claude-3-5-haiku',
          anthropicKey: 'ant-test'
        })
      })
    };

    const mockFetchResponse = {
      ok: true,
      json: async () => ({
        content: [
          { text: '```json\n{"result":"success anthropic"}\n```' }
        ]
      })
    };

    (global.fetch as any).mockResolvedValue(mockFetchResponse);

    const result = await extractDataFromDOM(mockDb, '<html><body>This is a fake DOM with enough content to pass the minimum length guard for extraction testing purposes in the unit test suite.</body></html>', 'Extract fake param');
    expect(global.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.any(Object));
    // Check if regex cleaning works
    expect(result).toBe('{"result":"success anthropic"}');
  });

  it('3. Deve extrair JSON via Google REST API corretamente', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          workerModel: 'gemini-2.5-flash',
          googleKey: 'ggle-test'
        })
      })
    };

    const mockFetchResponse = {
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: '{"result":"success google"}' }] }
        }]
      })
    };

    (global.fetch as any).mockResolvedValue(mockFetchResponse);

    const result = await extractDataFromDOM(mockDb, '<html><body>This is a fake DOM with enough content to pass the minimum length guard for extraction testing purposes in the unit test suite.</body></html>', 'Extract fake param');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('generativelanguage.googleapis.com'), expect.any(Object));
    expect(result).toBe('{"result":"success google"}');
  });
});
