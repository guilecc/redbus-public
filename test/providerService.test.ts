import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAvailableModels } from '../electron/services/providerService';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('providerService fetchAvailableModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Deve requerer uma API Key válida', async () => {
    await expect(fetchAvailableModels('openai', '')).rejects.toThrow('API Key is required to fetch models');
  });

  it('2. OpenAI: Deve buscar, filtrar apenas modelos gpt/o1/o3 e retornar mapeado', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4o' },
          { id: 'o1-preview' },
          { id: 'text-davinci-003' }, // Should be filtered out
          { id: 'gpt-3.5-turbo' }
        ]
      })
    } as Response);

    const models = await fetchAvailableModels('openai', 'sk-test');
    
    expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', {
      headers: { 'Authorization': 'Bearer sk-test' }
    });

    expect(models.length).toBe(3);
    const ids = models.map(m => m.id);
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('o1-preview');
    expect(ids).toContain('gpt-3.5-turbo');
    expect(ids).not.toContain('text-davinci-003');
  });

  it('3. Google: Deve buscar, filtrar por gemini e formatar IDs sem o path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
          { name: 'models/text-bison-001', displayName: 'Text Bison' }
        ]
      })
    } as Response);

    const models = await fetchAvailableModels('google', 'ai-key');
    
    expect(models.length).toBe(1);
    expect(models[0].id).toBe('gemini-2.5-flash');
    expect(models[0].name).toBe('Gemini 2.5 Flash');
  });

  it('4. Anthropic: Deve buscar modelos, tratar erro 401 como erro legível e formatar', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    } as Response);

    await expect(fetchAvailableModels('anthropic', 'sk-ant-123')).rejects.toThrow('Chave de API inválida ou sem permissão');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { type: 'model', id: 'claude-3-7-sonnet-20250219', display_name: 'Claude 3.7 Sonnet' },
          { type: 'model', id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' }
        ]
      })
    } as Response);

    const models = await fetchAvailableModels('anthropic', 'sk-ant-valid');
    expect(models.length).toBe(2);
    expect(models[0].id).toBe('claude-3-7-sonnet-20250219');
    expect(models[0].name).toBe('Claude 3.7 Sonnet');
  });
});
