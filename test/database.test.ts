import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// First, mock the electron app module to prevent runtime errors when importing database.ts
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => ''),
  },
}));

// Now we can import the database initializer
import { initializeDatabase, factoryReset } from '../electron/database';
import { saveMessage, getMessages } from '../electron/services/archiveService';
import { isDangerousCommand, executeCommand } from '../electron/services/forgeService';

describe('RedBus Local Database (SQLite)', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    // For tests we use the in-memory database feature from better-sqlite3
    db = initializeDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('1. Deve inicializar o banco e ativar o journal_mode = WAL', () => {
    expect(db).toBeDefined();
    expect(db.open).toBe(true);

    const pragma = db.pragma('journal_mode', { simple: true });
    expect(['wal', 'memory']).toContain(pragma);
  });

  it('2. Deve verificar se as tabelas estruturais essenciais foram criadas (ProviderConfigs, Conversations, LivingSpecs)', () => {
    // Check if ProviderConfigs exists
    const providerTableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ProviderConfigs'`).get();
    expect(providerTableExists).toBeDefined();

    // Check if Conversations exists
    const conversationsTableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='Conversations'`).get();
    expect(conversationsTableExists).toBeDefined();

    // Check if LivingSpecs exists
    const livingSpecsTableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='LivingSpecs'`).get();
    expect(livingSpecsTableExists).toBeDefined();
  });

  it('3. Deve ser possível inserir, ler e preservar chaves da ProviderConfigs', () => {
    // Redbus creates row with id=1 by default
    const rowId1 = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get() as any;
    expect(rowId1).toBeDefined();

    // Simulate updating API Keys and the `roles` JSON (Spec 06 — named roles)
    const rolesJson = JSON.stringify({
      planner: { model: 'o1', thinkingLevel: 'medium' },
      executor: { model: 'gemini-2.5-flash', thinkingLevel: 'off' },
      synthesizer: { model: 'gemini-2.5-flash', thinkingLevel: 'off' },
      utility: { model: 'gemini-2.5-flash', thinkingLevel: 'off' },
    });
    const stmt = db.prepare(`
      UPDATE ProviderConfigs
      SET openAiKey = ?, roles = ?
      WHERE id = 1
    `);

    const info = stmt.run('sk-test-fake-key-123', rolesJson);
    expect(info.changes).toBe(1);

    // Read back
    const updatedRow = db.prepare('SELECT openAiKey, roles FROM ProviderConfigs WHERE id = 1').get() as any;
    expect(updatedRow.openAiKey).toBe('sk-test-fake-key-123');
    expect(JSON.parse(updatedRow.roles).planner.model).toBe('o1');
  });

  it('4. Deve suportar campos de agendamento (cron_expression e last_run) no LivingSpecs', () => {
    // Insere conversation proxy
    db.prepare("INSERT INTO Conversations (id, title) VALUES ('conv-1', 'Teste')").run();

    // Insere Spec com Cron
    db.prepare(`
      INSERT INTO LivingSpecs (id, conversationId, specJson, cron_expression, last_run)
      VALUES ('spec-1', 'conv-1', '{}', '0 9 * * *', '2026-03-31 09:00:00')
    `).run();

    // Valida no banco
    const row = db.prepare("SELECT cron_expression, last_run FROM LivingSpecs WHERE id = 'spec-1'").get() as any;
    expect(row.cron_expression).toBe('0 9 * * *');
    expect(row.last_run).toBe('2026-03-31 09:00:00');
  });

  it('5. Deve criar as tabelas da Alma e Memória (UserProfile e VectorMemory)', () => {
    // Check if UserProfile exists
    const userProfileTableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='UserProfile'`).get();
    expect(userProfileTableExists).toBeDefined();

    // Check if VectorMemory exists
    const vectorMemoryTableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='VectorMemory'`).get();
    expect(vectorMemoryTableExists).toBeDefined();
  });

  it('6. Deve ser possível inserir e ler dados da tabela UserProfile', () => {
    const stmt = db.prepare(`
      INSERT INTO UserProfile (id, name, role, preferences, system_prompt_compiled)
      VALUES (?, ?, ?, ?, ?)
    `);

    const info = stmt.run('default', 'Guile', 'Developer', 'Be concise', 'You are RedBus...');
    expect(info.changes).toBe(1);

    const row = db.prepare('SELECT * FROM UserProfile WHERE id = ?').get('default') as any;
    expect(row.name).toBe('Guile');
    expect(row.role).toBe('Developer');
    expect(row.system_prompt_compiled).toBe('You are RedBus...');
  });

  // ── REGRESSION: Persistência bidirecional (user + assistant) ──
  it('7. REGRESSÃO: Deve persistir mensagens de AMBOS os roles (user e assistant) na tabela ChatMessages', () => {

    // Simula o fluxo completo: usuário envia → assistente responde
    saveMessage(db, { id: 'msg-user-1', role: 'user', content: 'Qual o clima hoje?' });
    saveMessage(db, { id: 'msg-assistant-1', role: 'assistant', content: 'Hoje está ensolarado, 28°C.' });

    const msgs = getMessages(db, 10, 0);
    expect(msgs).toHaveLength(2);

    // Verifica role de cada mensagem
    const userMsg = msgs.find((m: any) => m.id === 'msg-user-1');
    const assistantMsg = msgs.find((m: any) => m.id === 'msg-assistant-1');

    expect(userMsg).toBeDefined();
    expect(userMsg?.role).toBe('user');
    expect(userMsg?.content).toBe('Qual o clima hoje?');

    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.role).toBe('assistant');
    expect(assistantMsg?.content).toBe('Hoje está ensolarado, 28°C.');
  });

  it('9. Deve criar a tabela ConversationSummary com resumo vazio e suportar flag compacted em ChatMessages', () => {
    // ConversationSummary table exists
    const summaryTableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ConversationSummary'`).get();
    expect(summaryTableExists).toBeDefined();

    // Default row exists with empty summary
    const row = db.prepare('SELECT * FROM ConversationSummary WHERE id = 1').get() as any;
    expect(row).toBeDefined();
    expect(row.summary).toBe('');

    // ChatMessages compacted column works
    saveMessage(db, { id: 'compact-test-1', role: 'user', content: 'teste' });
    const msg = db.prepare("SELECT compacted FROM ChatMessages WHERE id = 'compact-test-1'").get() as any;
    expect(msg.compacted).toBe(0);

    // Can mark as compacted
    db.prepare("UPDATE ChatMessages SET compacted = 1 WHERE id = 'compact-test-1'").run();
    const updated = db.prepare("SELECT compacted FROM ChatMessages WHERE id = 'compact-test-1'").get() as any;
    expect(updated.compacted).toBe(1);
  });

  it('8. REGRESSÃO: Deve persistir mensagens de spec (Living Spec) com type e specData', () => {

    const specData = JSON.stringify({
      goal: 'Check Jira',
      status: 'completed',
      steps: [{ label: 'nav → https://jira.com', status: 'completed' }]
    });

    saveMessage(db, {
      id: 'msg-spec-1',
      role: 'assistant',
      content: '',
      type: 'spec',
      specData
    });

    const msgs = getMessages(db, 10, 0);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].type).toBe('spec');
    expect(msgs[0].specData).toBe(specData);
  });

  it('10. FACTORY RESET: Deve limpar todas as tabelas exceto ProviderConfigs', () => {
    // Populate all tables
    saveMessage(db, { id: 'fr-msg-1', role: 'user', content: 'Hello' });
    saveMessage(db, { id: 'fr-msg-2', role: 'assistant', content: 'Hi!' });
    db.prepare(`INSERT OR REPLACE INTO UserProfile (id, name, role, preferences, system_prompt_compiled) VALUES ('default', 'Guile', 'Dev', 'prefs', 'Be helpful.')`).run();
    db.prepare(`INSERT INTO Conversations (id, title) VALUES ('conv-1', 'Test Conv')`).run();
    db.prepare(`INSERT INTO LivingSpecs (id, conversationId, specJson) VALUES ('spec-1', 'conv-1', '{}')`).run();
    db.prepare(`INSERT INTO VectorMemory (id, content) VALUES ('vec-1', 'memory data')`).run();
    db.prepare(`INSERT INTO EmbeddingsMemory (id, content) VALUES ('emb-1', 'embedding data')`).run();
    db.prepare(`UPDATE ConversationSummary SET summary = 'Some summary' WHERE id = 1`).run();
    db.prepare(`UPDATE ProviderConfigs SET anthropicKey = 'ant-key-123', googleKey = 'goog-key-456' WHERE id = 1`).run();

    // Execute factory reset (no archives dir in test)
    factoryReset(db, '/tmp/redbus-test-nonexistent');

    // All user data tables should be empty
    expect((db.prepare('SELECT COUNT(*) as c FROM ChatMessages').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) as c FROM UserProfile').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) as c FROM Conversations').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) as c FROM LivingSpecs').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) as c FROM VectorMemory').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) as c FROM EmbeddingsMemory').get() as any).c).toBe(0);

    // ConversationSummary should be reset to empty string (row preserved)
    const summary = db.prepare('SELECT summary FROM ConversationSummary WHERE id = 1').get() as any;
    expect(summary.summary).toBe('');

    // ProviderConfigs MUST be preserved
    const configs = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get() as any;
    expect(configs).toBeDefined();
    expect(configs.anthropicKey).toBeNull();
    expect(configs.googleKey).toBeNull();
  });

  it('11. FACTORY RESET: Deve deletar arquivos de archive do disco', () => {
    const fs = require('fs');
    const path = require('path');
    const tmpDir = '/tmp/redbus-factory-reset-test-' + Date.now();
    const archivesDir = path.join(tmpDir, 'archives');
    fs.mkdirSync(archivesDir, { recursive: true });

    // Create fake archive files
    fs.writeFileSync(path.join(archivesDir, '.redbus_archive_20260101.sqlite'), 'fake');
    fs.writeFileSync(path.join(archivesDir, '.redbus_archive_20260201.sqlite'), 'fake');

    expect(fs.readdirSync(archivesDir).length).toBe(2);

    factoryReset(db, tmpDir);

    // Archive files should be deleted
    const remaining = fs.readdirSync(archivesDir).filter((f: string) => f.endsWith('.sqlite'));
    expect(remaining.length).toBe(0);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('12. Deve criar a tabela SkillsIndex com campos canônicos (name, description, frontmatter_json, body_path, mtime_ms)', () => {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='SkillsIndex'`).get();
    expect(tableExists).toBeDefined();

    db.prepare(`INSERT INTO SkillsIndex (name, description, frontmatter_json, body_path, mtime_ms) VALUES (?, ?, ?, ?, ?)`).run(
      'test_skill', 'A test skill', '{"name":"test_skill","description":"A test skill"}', '/tmp/test_skill/SKILL.md', 12345
    );

    const row = db.prepare('SELECT * FROM SkillsIndex WHERE name = ?').get('test_skill') as any;
    expect(row.name).toBe('test_skill');
    expect(row.description).toBe('A test skill');
    expect(row.body_path).toBe('/tmp/test_skill/SKILL.md');
    expect(row.mtime_ms).toBe(12345);
    expect(JSON.parse(row.frontmatter_json).name).toBe('test_skill');
  });

  it('13. SkillsIndex.name deve ser UNIQUE', () => {
    db.prepare(`INSERT INTO SkillsIndex (name, description, frontmatter_json, body_path, mtime_ms) VALUES (?, ?, ?, ?, ?)`).run(
      'unique_skill', 'v1', '{}', '/a', 1
    );
    expect(() =>
      db.prepare(`INSERT INTO SkillsIndex (name, description, frontmatter_json, body_path, mtime_ms) VALUES (?, ?, ?, ?, ?)`).run(
        'unique_skill', 'v2', '{}', '/b', 2
      )
    ).toThrow();
  });

  it('14. Deve limpar SkillsIndex no factory reset', () => {
    db.prepare(`INSERT INTO SkillsIndex (name, description, frontmatter_json, body_path, mtime_ms) VALUES (?, ?, ?, ?, ?)`).run(
      'reset_skill', 'x', '{}', '/tmp/x/SKILL.md', 1
    );

    factoryReset(db, '/tmp/test-redbus');

    const rows = db.prepare('SELECT COUNT(*) as c FROM SkillsIndex').get() as any;
    expect(rows.c).toBe(0);
  });

  it('15. NÃO deve criar tabelas legadas ForgeSnippets/ForgeExecutions', () => {
    const snippets = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ForgeSnippets'`).get();
    const executions = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ForgeExecutions'`).get();
    expect(snippets).toBeUndefined();
    expect(executions).toBeUndefined();
  });
});

describe('ForgeService — Security', () => {
  it('7. isDangerousCommand deve detectar rm -rf', () => {
    expect(isDangerousCommand('rm -rf /')).toBe(true);
    expect(isDangerousCommand('rm -fr /tmp')).toBe(true);
    expect(isDangerousCommand('sudo apt install')).toBe(true);
  });

  it('8. isDangerousCommand deve permitir comandos seguros', () => {
    expect(isDangerousCommand('echo hello')).toBe(false);
    expect(isDangerousCommand('python3 -c "print(1)"')).toBe(false);
    expect(isDangerousCommand('ls -la')).toBe(false);
    expect(isDangerousCommand('cat file.txt')).toBe(false);
  });
});

describe('ForgeService — Execution', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('9. executeCommand deve executar echo e retornar stdout', async () => {
    const result = await executeCommand(db, 'echo "hello forge"');
    expect(result.exit_code).toBe(0);
    expect(result.stdout.trim()).toBe('hello forge');
    expect(result.timed_out).toBe(false);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('11. executeCommand deve capturar exit code não-zero', async () => {
    const result = await executeCommand(db, 'exit 42');
    expect(result.exit_code).toBe(42);
  });

  it('12. executeCommand deve capturar stderr', async () => {
    const result = await executeCommand(db, 'echo error >&2');
    expect(result.stderr.trim()).toBe('error');
  });
});