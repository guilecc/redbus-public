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
import { writeSnippet, readSnippet, listSnippets, isDangerousCommand, executeCommand } from '../electron/services/forgeService';

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

    // Simulate updating API Keys and Maestro models
    const stmt = db.prepare(`
      UPDATE ProviderConfigs
      SET openAiKey = ?, maestroModel = ?
      WHERE id = 1
    `);

    const info = stmt.run('sk-test-fake-key-123', 'o1');
    expect(info.changes).toBe(1);

    // Read back
    const updatedRow = db.prepare('SELECT openAiKey, maestroModel FROM ProviderConfigs WHERE id = 1').get() as any;
    expect(updatedRow.openAiKey).toBe('sk-test-fake-key-123');
    expect(updatedRow.maestroModel).toBe('o1');
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
    expect(configs.anthropicKey).toBe('ant-key-123');
    expect(configs.googleKey).toBe('goog-key-456');
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

  it('12. Deve criar a tabela ForgeSnippets com campos de skill (parameters_schema, required_vault_keys, version)', () => {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ForgeSnippets'`).get();
    expect(tableExists).toBeDefined();

    // Insert a snippet with skill fields
    db.prepare(`INSERT INTO ForgeSnippets (name, language, code, description, parameters_schema, required_vault_keys) VALUES (?, ?, ?, ?, ?, ?)`).run(
      'test_skill', 'python', 'print("ok")', 'A test skill', '{}', '[]'
    );

    const snippet = db.prepare('SELECT * FROM ForgeSnippets WHERE name = ?').get('test_skill') as any;
    expect(snippet.name).toBe('test_skill');
    expect(snippet.version).toBe(1);
    expect(snippet.code).toBe('print("ok")');
    expect(snippet.language).toBe('python');
  });

  // ── Forge Tables ──

  it('13. Deve criar tabelas ForgeSnippets e ForgeExecutions', () => {
    const snippetsTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ForgeSnippets'`).get();
    expect(snippetsTable).toBeDefined();

    const execTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ForgeExecutions'`).get();
    expect(execTable).toBeDefined();
  });

  it('14. Deve inserir e consultar ForgeSnippets', () => {
    db.prepare(`INSERT INTO ForgeSnippets (name, language, code, description, tags) VALUES (?, ?, ?, ?, ?)`).run(
      'test_script', 'python', 'print("hello")', 'A test script', '["test","python"]'
    );

    const snippet = db.prepare('SELECT * FROM ForgeSnippets WHERE name = ?').get('test_script') as any;
    expect(snippet.name).toBe('test_script');
    expect(snippet.language).toBe('python');
    expect(snippet.code).toBe('print("hello")');
    expect(JSON.parse(snippet.tags)).toEqual(['test', 'python']);
    expect(snippet.use_count).toBe(0);
  });

  it('15. Deve inserir ForgeExecutions com referência a snippet', () => {
    db.prepare(`INSERT INTO ForgeSnippets (name, language, code) VALUES (?, ?, ?)`).run('exec_test', 'bash', 'echo hi');
    const snippet = db.prepare('SELECT id FROM ForgeSnippets WHERE name = ?').get('exec_test') as any;

    db.prepare(`INSERT INTO ForgeExecutions (snippet_id, command, stdout, exit_code, duration_ms) VALUES (?, ?, ?, ?, ?)`).run(
      snippet.id, 'echo hi', 'hi\n', 0, 50
    );

    const exec = db.prepare('SELECT * FROM ForgeExecutions WHERE snippet_id = ?').get(snippet.id) as any;
    expect(exec.command).toBe('echo hi');
    expect(exec.stdout).toBe('hi\n');
    expect(exec.exit_code).toBe(0);
    expect(exec.duration_ms).toBe(50);
  });

  it('16. Deve limpar ForgeSnippets e ForgeExecutions no factory reset', () => {
    db.prepare(`INSERT INTO ForgeSnippets (name, language, code) VALUES (?, ?, ?)`).run('reset_test', 'bash', 'echo reset');
    db.prepare(`INSERT INTO ForgeExecutions (command, stdout, exit_code, duration_ms) VALUES (?, ?, ?, ?)`).run('echo reset', 'reset\n', 0, 10);

    factoryReset(db, '/tmp/test-redbus');

    const snippets = db.prepare('SELECT COUNT(*) as c FROM ForgeSnippets').get() as any;
    const execs = db.prepare('SELECT COUNT(*) as c FROM ForgeExecutions').get() as any;
    expect(snippets.c).toBe(0);
    expect(execs.c).toBe(0);
  });
});


describe('ForgeService — Snippet CRUD', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('1. writeSnippet deve salvar e retornar snippet com id', () => {
    const snippet = writeSnippet(db, {
      name: 'hello_world',
      language: 'python',
      code: 'print("hello")',
      description: 'A hello world script',
      tags: ['test', 'demo'],
    });
    expect(snippet.id).toBeGreaterThan(0);
    expect(snippet.name).toBe('hello_world');
    expect(snippet.language).toBe('python');
    expect(snippet.tags).toEqual(['test', 'demo']);
  });

  it('2. writeSnippet deve fazer upsert em nome duplicado', () => {
    writeSnippet(db, { name: 'dup', language: 'bash', code: 'echo v1' });
    const updated = writeSnippet(db, { name: 'dup', language: 'bash', code: 'echo v2' });
    expect(updated.code).toBe('echo v2');

    // Should only have 1 record
    const count = db.prepare('SELECT COUNT(*) as c FROM ForgeSnippets WHERE name = ?').get('dup') as any;
    expect(count.c).toBe(1);
  });

  it('3. readSnippet deve retornar null para snippet inexistente', () => {
    const result = readSnippet(db, 'nonexistent');
    expect(result).toBeNull();
  });

  it('4. readSnippet deve incrementar use_count', () => {
    writeSnippet(db, { name: 'counter', language: 'bash', code: 'echo hi' });
    readSnippet(db, 'counter');
    readSnippet(db, 'counter');
    const row = db.prepare('SELECT use_count FROM ForgeSnippets WHERE name = ?').get('counter') as any;
    expect(row.use_count).toBe(2);
  });

  it('5. listSnippets deve filtrar por linguagem', () => {
    writeSnippet(db, { name: 's1', language: 'python', code: 'x' });
    writeSnippet(db, { name: 's2', language: 'bash', code: 'y' });
    writeSnippet(db, { name: 's3', language: 'python', code: 'z' });

    const pythonOnly = listSnippets(db, { language: 'python' });
    expect(pythonOnly.length).toBe(2);
    expect(pythonOnly.every(s => s.language === 'python')).toBe(true);
  });

  it('6. listSnippets deve filtrar por tag', () => {
    writeSnippet(db, { name: 't1', language: 'bash', code: 'x', tags: ['email', 'outlook'] });
    writeSnippet(db, { name: 't2', language: 'bash', code: 'y', tags: ['jira'] });

    const emailOnly = listSnippets(db, { tag: 'email' });
    expect(emailOnly.length).toBe(1);
    expect(emailOnly[0].name).toBe('t1');
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

  it('10. executeCommand deve registrar execução no banco', async () => {
    await executeCommand(db, 'echo logged');
    const rows = db.prepare('SELECT * FROM ForgeExecutions').all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].command).toBe('echo logged');
    expect(rows[0].exit_code).toBe(0);
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