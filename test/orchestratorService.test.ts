import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSpecFromPrompt, setAgentState } from '../electron/services/orchestratorService';
import { getMessages, countMessages, getUncompactedMessages } from '../electron/services/archiveService';

describe('Orchestrator Service - Maestro', () => {

  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('1. Deve extrair um spec válido e salvar na tabela LivingSpecs via Maestro (Anthropic)', async () => {
    // Mock the database
    const mockDb = {
      prepare: vi.fn((query) => {
        return {
          get: vi.fn().mockImplementation(() => {
            if (query.includes('ProviderConfigs')) {
              return {
                maestroModel: 'claude-3-7-sonnet-20250219',
                anthropicKey: 'ant-test-key'
              };
            }
            if (query.includes('UserProfile')) {
              return { system_prompt_compiled: 'Be professional.' };
            }
            if (query.includes('ConversationSummary')) {
              return { summary: '' };
            }
            if (query.includes('COUNT')) {
              return { count: 0 };
            }
            return null;
          }),
          all: vi.fn().mockReturnValue([]),
          run: vi.fn()
        };
      })
    };

    // Fake Spec Response wrapped in markdown (with thinking field)
    const fakeSpec = {
      thinking: "1. UNDERSTAND: User wants daily Jira checks at 9am weekdays. 2. CONTEXT: No prior context. 3. CANDIDATES: FORMAT A (browser) vs FORMAT D (skill). No existing skill, so FORMAT A. 4. DECISION: FORMAT A — browser navigation to Jira. 5. SELF-CRITIQUE: Looks correct, clear goal.",
      goal: "Check Jira daily",
      cron_expression: "0 9 * * 1-5",
      steps: [
        { url: "https://jira.com", instruction: "Extract sprint status" }
      ]
    };

    const mockFetchResponse = {
      ok: true,
      json: async () => ({
        content: [
          { text: '```json\n' + JSON.stringify(fakeSpec) + '\n```' }
        ]
      })
    };

    (global.fetch as any).mockResolvedValue(mockFetchResponse);

    const result = await createSpecFromPrompt(mockDb, 'Check my jira every weekday at 9am');

    expect(global.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.any(Object));
    expect(result.parsedSpec.goal).toBe('Check Jira daily');
    expect(result.parsedSpec.cron_expression).toBe('0 9 * * 1-5');

    // Valida chamadas no banco:
    // Uma chamada inicial pro config, uma de create Conversation, uma de create LivingSpecs
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Conversations'));
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO LivingSpecs'));
  });

  it('2. Deve acionar modo ONBOARDING se UserProfile não existir', async () => {
    const mockDb = {
      prepare: vi.fn((query) => {
        return {
          get: vi.fn().mockImplementation(() => {
            if (query.includes('ProviderConfigs')) {
              return {
                maestroModel: 'claude-3-7-sonnet-20250219',
                anthropicKey: 'ant-test-key'
              };
            }
            if (query.includes('UserProfile')) {
              return null; // Força onboarding
            }
            return null;
          }),
          run: vi.fn()
        };
      }),
      run: vi.fn()
    };

    const onboardingSpec = {
      onboarding_reply: "Olá humano, sou o RedBus.",
      finalize_soul_setup: null
    };

    const mockFetchResponse = {
      ok: true,
      json: async () => ({
        content: [
          { text: '```json\n' + JSON.stringify(onboardingSpec) + '\n```' }
        ]
      })
    };

    (global.fetch as any).mockResolvedValue(mockFetchResponse);

    const result = await createSpecFromPrompt(mockDb, 'Oi');

    expect(result.status).toBe('ONBOARDING_CONTINUE');
    expect(result.reply).toBe('Olá humano, sou o RedBus.');
  });

  it('3. REGRESSÃO: Fluxo completo deve gerar persistência bidirecional (user + assistant) no banco real', async () => {
    // Este teste usa um DB in-memory real para validar a persistência end-to-end
    vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '') } }));
    const { initializeDatabase } = await import('../electron/database');
    const { saveMessage, getMessages } = await import('../electron/services/archiveService');
    const db = initializeDatabase(':memory:');

    try {
      // Configura provider para o maestro funcionar
      db.prepare(`UPDATE ProviderConfigs SET anthropicKey = 'ant-test', maestroModel = 'claude-3-7-sonnet-20250219' WHERE id = 1`).run();
      db.prepare(`INSERT OR REPLACE INTO UserProfile (id, name, role, preferences, system_prompt_compiled) VALUES ('default', 'Test', 'Dev', '', 'Be helpful.')`).run();

      // Simula persistência do user prompt (feito pelo frontend)
      saveMessage(db, { id: 'user-msg-1', role: 'user', content: 'Verifique o Jira' });

      // Simula a resposta do Maestro gerando spec
      const fakeSpec = {
        goal: "Check Jira",
        cron_expression: null,
        steps: [{ url: "https://jira.com", instruction: "Extract data" }]
      };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: JSON.stringify(fakeSpec) }] })
      });

      const result = await createSpecFromPrompt(db, 'Verifique o Jira');

      // Simula persistência da resposta do assistant (feito pelo backend no execute-spec)
      saveMessage(db, { id: 'assistant-reply-1', role: 'assistant', content: 'Dados extraídos do Jira com sucesso.' });
      // Simula persistência do spec card (feito pelo backend)
      saveMessage(db, {
        id: result.specId, role: 'assistant', content: '',
        type: 'spec',
        specData: JSON.stringify({ goal: fakeSpec.goal, status: 'completed', steps: [] })
      });

      // Valida: banco deve ter EXATAMENTE 1 user + 2 assistant = 3 mensagens
      const msgs = getMessages(db, 20, 0);
      expect(msgs.length).toBe(3);

      const userMsgs = msgs.filter((m: any) => m.role === 'user');
      const assistantMsgs = msgs.filter((m: any) => m.role === 'assistant');

      expect(userMsgs).toHaveLength(1);
      expect(assistantMsgs).toHaveLength(2);
      expect(userMsgs[0].content).toBe('Verifique o Jira');
      expect(assistantMsgs.some((m: any) => m.content === 'Dados extraídos do Jira com sucesso.')).toBe(true);
      expect(assistantMsgs.some((m: any) => m.type === 'spec')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('4. Maestro thinking field: deve ser extraído, logado e removido do spec final', async () => {
    vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '') } }));
    const { initializeDatabase } = await import('../electron/database');
    const db = initializeDatabase(':memory:');

    try {
      db.prepare(`UPDATE ProviderConfigs SET anthropicKey = 'ant-test', maestroModel = 'claude-3-7-sonnet-20250219' WHERE id = 1`).run();
      db.prepare(`INSERT OR REPLACE INTO UserProfile (id, name, role, preferences, system_prompt_compiled) VALUES ('default', 'Test', 'Dev', '', 'Be helpful.')`).run();

      const fakeSpec = {
        thinking: "1. UNDERSTAND: User wants weather. 2. CONTEXT: No clipboard data. 3. CANDIDATES: FORMAT B (python script to call weather API) or FORMAT C (just reply). 4. DECISION: FORMAT B — python script. 5. SELF-CRITIQUE: Correct, straightforward task.",
        goal: "Get weather for São Paulo",
        cron_expression: null,
        python_script: "import requests; print(requests.get('https://wttr.in/SaoPaulo?format=j1').text)",
        steps: []
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: JSON.stringify(fakeSpec) }] })
      });

      const consoleSpy = vi.spyOn(console, 'log');
      const result = await createSpecFromPrompt(db, 'Qual o clima em São Paulo?');

      // Thinking should have been logged
      expect(consoleSpy).toHaveBeenCalledWith('[Maestro Thinking]', expect.stringContaining('UNDERSTAND'));

      // Thinking should be saved to ChatMessages as type='thinking' (raw query)
      const thinkingMsgs = db.prepare("SELECT * FROM ChatMessages WHERE type = 'thinking'").all();
      expect(thinkingMsgs.length).toBeGreaterThanOrEqual(1);
      expect((thinkingMsgs[0] as any).content).toContain('UNDERSTAND');

      // Thinking should NOT be in the parsedSpec
      expect(result.parsedSpec.thinking).toBeUndefined();

      // Goal should still be there
      expect(result.parsedSpec.goal).toBe('Get weather for São Paulo');

      // ── CRITICAL: thinking must NOT leak into user-facing queries ──
      const visibleMessages = getMessages(db, 100, 0);
      const hasThinking = visibleMessages.some((m: any) => m.type === 'thinking');
      expect(hasThinking).toBe(false);

      const uncompacted = getUncompactedMessages(db);
      const hasThinkingUncompacted = uncompacted.some((m: any) => m.type === 'thinking');
      expect(hasThinkingUncompacted).toBe(false);

      // Count should NOT include thinking messages
      const totalRaw = (db.prepare('SELECT COUNT(*) as c FROM ChatMessages').get() as any).c;
      const totalFiltered = countMessages(db);
      expect(totalFiltered).toBeLessThan(totalRaw);

      consoleSpy.mockRestore();
    } finally {
      db.close();
    }
  });

  it('5. Maestro thinking: FORMAT C conversacional deve extrair thinking e manter goal', async () => {
    vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '') } }));
    const { initializeDatabase } = await import('../electron/database');
    const db = initializeDatabase(':memory:');

    try {
      db.prepare(`UPDATE ProviderConfigs SET anthropicKey = 'ant-test', maestroModel = 'claude-3-7-sonnet-20250219' WHERE id = 1`).run();
      db.prepare(`INSERT OR REPLACE INTO UserProfile (id, name, role, preferences, system_prompt_compiled) VALUES ('default', 'Test', 'Dev', '', 'Be helpful.')`).run();

      const fakeSpec = {
        thinking: "1. UNDERSTAND: User says 'obrigado'. This is a simple conversational exchange. 2. CONTEXT: No action needed. 3. CANDIDATES: Only FORMAT C applies. 4. DECISION: FORMAT C. 5. SELF-CRITIQUE: Correct.",
        goal: "De nada! Estou aqui se precisar.",
        cron_expression: null,
        steps: []
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ text: JSON.stringify(fakeSpec) }] })
      });

      const result = await createSpecFromPrompt(db, 'Obrigado!');

      // Thinking field is extracted and removed from parsedSpec
      expect(result.parsedSpec.thinking).toBeUndefined();
      // Goal is preserved for FORMAT C (conversational reply lives in parsedSpec.goal)
      expect(result.parsedSpec.goal).toBe('De nada! Estou aqui se precisar.');
      // Steps should be empty (conversational)
      expect(result.parsedSpec.steps).toEqual([]);
    } finally {
      db.close();
    }
  });

  // ══════════════════════════════════════════════════════════
  // TESTE REAL COM GOOGLE API (E2E — Gemini)
  // ══════════════════════════════════════════════════════════

  it('6. E2E: Deve chamar Gemini real e retornar spec válido (FORMAT C conversacional)', async () => {
    const GOOGLE_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyD0yQjbTqMCKwIHRpuwLifHrZdivMMUS0M';
    // Use real DB
    const { initializeDatabase } = await import('../electron/database');
    const db = initializeDatabase(':memory:');

    // Setup UserProfile + ProviderConfigs for Gemini
    db.prepare(`
      INSERT OR REPLACE INTO UserProfile (id, name, role, preferences, system_prompt_compiled)
      VALUES ('default', 'Guile', 'dev', 'conciso', 'Você é o RedBus, assistente de produtividade. Responda em português de forma concisa.')
    `).run();
    db.prepare(`UPDATE ProviderConfigs SET maestroModel = 'gemini-2.5-flash', googleKey = ? WHERE id = 1`).run(GOOGLE_KEY);

    // Use real fetch (not mocked)
    global.fetch = originalFetch;

    try {
      const result = await createSpecFromPrompt(db, 'Qual o sentido da vida?');
      expect(result).toBeDefined();
      // Should be FORMAT C (conversational) — no browser steps
      expect(result.parsedSpec).toBeDefined();
      expect(result.parsedSpec.goal).toBeDefined();
      expect(typeof result.parsedSpec.goal).toBe('string');
      expect(result.parsedSpec.goal.length).toBeGreaterThan(5);
      console.log('[E2E Gemini] goal:', result.parsedSpec.goal);
    } finally {
      db.close();
    }
  }, 30000); // 30s timeout for real API call

  it('7. Anti-loop: mensagens duplicadas devem ser removidas do contexto LLM', async () => {
    const GOOGLE_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyD0yQjbTqMCKwIHRpuwLifHrZdivMMUS0M';
    const { initializeDatabase } = await import('../electron/database');
    const { saveMessage } = await import('../electron/services/archiveService');
    const db = initializeDatabase(':memory:');

    db.prepare(`
      INSERT OR REPLACE INTO UserProfile (id, name, role, preferences, system_prompt_compiled)
      VALUES ('default', 'Guile', 'dev', 'conciso', 'Você é o RedBus. Responda em português.')
    `).run();
    db.prepare(`UPDATE ProviderConfigs SET maestroModel = 'gemini-2.5-flash', googleKey = ? WHERE id = 1`).run(GOOGLE_KEY);

    // Simulate loop: 5 identical error messages from assistant
    const errorMsg = 'O sensor de acessibilidade não está disponível neste build.';
    for (let i = 0; i < 5; i++) {
      saveMessage(db, { id: `err-${i}`, role: 'user', content: 'teste' });
      saveMessage(db, { id: `err-reply-${i}`, role: 'assistant', content: errorMsg });
    }

    // Now send a real user message — the LLM should NOT repeat the error
    global.fetch = originalFetch;
    try {
      const result = await createSpecFromPrompt(db, 'oi, tudo bem?');
      expect(result).toBeDefined();
      expect(result.parsedSpec).toBeDefined();
      const reply = result.parsedSpec.goal || '';
      console.log('[E2E Anti-loop] reply:', reply);
      // The reply should NOT be the same error message
      expect(reply).not.toContain('sensor de acessibilidade');
    } finally {
      db.close();
    }
  }, 30000);

});
