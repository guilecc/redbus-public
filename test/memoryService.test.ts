import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
}));

import { initializeDatabase } from '../electron/database';
import {
  saveMessage,
  getUncompactedMessages,
  countUncompactedMessages,
  getConversationSummary,
  updateConversationSummary,
  markMessagesAsCompacted,
} from '../electron/services/archiveService';
import { compactHistoryIfNeeded, generateCompactedSummary } from '../electron/services/memoryService';

describe('MemoryService - Context Compaction', () => {
  let db: ReturnType<typeof initializeDatabase>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    // Setup provider configs for LLM calls
    db.prepare(`UPDATE ProviderConfigs SET googleKey = 'test-key', workerModel = 'gemini-2.5-flash' WHERE id = 1`).run();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    db.close();
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('1. Deve retornar resumo vazio quando ConversationSummary é inicializada', () => {
    const summary = getConversationSummary(db);
    expect(summary).toBe('');
  });

  it('2. Deve atualizar e ler o ConversationSummary corretamente', () => {
    updateConversationSummary(db, 'O usuário se chama Guile e trabalha com automação.');
    const summary = getConversationSummary(db);
    expect(summary).toBe('O usuário se chama Guile e trabalha com automação.');
  });

  it('3. Deve contar apenas mensagens não-compactadas', () => {
    saveMessage(db, { id: 'm1', role: 'user', content: 'Olá' });
    saveMessage(db, { id: 'm2', role: 'assistant', content: 'Oi!' });
    saveMessage(db, { id: 'm3', role: 'user', content: 'Tudo bem?' });

    expect(countUncompactedMessages(db)).toBe(3);

    markMessagesAsCompacted(db, ['m1', 'm2']);
    expect(countUncompactedMessages(db)).toBe(1);
  });

  it('4. Deve retornar apenas mensagens não-compactadas', () => {
    saveMessage(db, { id: 'm1', role: 'user', content: 'Msg 1' });
    saveMessage(db, { id: 'm2', role: 'assistant', content: 'Msg 2' });
    saveMessage(db, { id: 'm3', role: 'user', content: 'Msg 3' });

    markMessagesAsCompacted(db, ['m1']);

    const uncompacted = getUncompactedMessages(db);
    expect(uncompacted).toHaveLength(2);
    expect(uncompacted[0].id).toBe('m2');
    expect(uncompacted[1].id).toBe('m3');
  });

  it('5. NÃO deve disparar compactação quando há menos de 20 mensagens não-compactadas', async () => {
    // Insert only 5 messages
    for (let i = 0; i < 5; i++) {
      saveMessage(db, { id: `m${i}`, role: 'user', content: `msg ${i}` });
    }

    await compactHistoryIfNeeded(db);

    // Nothing should be compacted
    expect(countUncompactedMessages(db)).toBe(5);
    expect(getConversationSummary(db)).toBe('');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('6. DEVE disparar compactação quando há 20+ mensagens e marcar 15 como compactadas', async () => {
    // Insert 22 messages
    for (let i = 0; i < 22; i++) {
      saveMessage(db, { id: `m${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: `mensagem ${i}` });
    }

    // Mock LLM response
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Resumo compactado: 22 mensagens sobre testes.' }] } }]
      })
    });

    await compactHistoryIfNeeded(db);

    // 15 should be compacted, 7 remain
    expect(countUncompactedMessages(db)).toBe(7);
    expect(getConversationSummary(db)).toBe('Resumo compactado: 22 mensagens sobre testes.');
    // 2 calls: 1 for summary compaction + 1 for fact extraction (parallel)
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('7. Deve integrar resumo existente com novas mensagens na compactação', async () => {
    // Set initial summary
    updateConversationSummary(db, 'O usuário pediu para monitorar o Jira.');

    // Insert 20 new messages
    for (let i = 0; i < 20; i++) {
      saveMessage(db, { id: `m${i}`, role: 'user', content: `nova msg ${i}` });
    }

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Resumo atualizado: Jira + 20 novas interações.' }] } }]
      })
    });

    await compactHistoryIfNeeded(db);

    const summary = getConversationSummary(db);
    expect(summary).toBe('Resumo atualizado: Jira + 20 novas interações.');

    // Verify the LLM received the existing summary in the prompt
    const fetchCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    const promptText = body.contents[0].parts[0].text;
    expect(promptText).toContain('EXISTING SUMMARY');
    expect(promptText).toContain('O usuário pediu para monitorar o Jira.');
  });

  it('8. Deve ser resiliente a falhas do LLM (não crashar, não compactar)', async () => {
    for (let i = 0; i < 22; i++) {
      saveMessage(db, { id: `m${i}`, role: 'user', content: `msg ${i}` });
    }

    (global.fetch as any).mockResolvedValue({ ok: false, text: async () => 'API Error 500' });

    // Should not throw
    await compactHistoryIfNeeded(db);

    // Nothing should have been compacted (LLM failed)
    expect(countUncompactedMessages(db)).toBe(22);
    expect(getConversationSummary(db)).toBe('');
  });
});

