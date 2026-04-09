import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  safeStorage: null,
}));

import { initializeDatabase } from '../electron/database';
import { saveSecret } from '../electron/services/vaultService';
import { executePython } from '../electron/services/pythonExecutor';

describe('PythonExecutor — Script Execution', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('1. Deve executar um script Python simples e capturar stdout', async () => {
    const result = await executePython(db, 'print("hello redbus")', []);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello redbus');
    expect(result.stderr).toBe('');
  });

  it('2. Deve capturar stderr em caso de erro de sintaxe', async () => {
    const result = await executePython(db, 'print(undefined_var)', []);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('NameError');
  });

  it('3. Deve executar script com I/O standard (JSON via stdout)', async () => {
    const script = `
import json
print(json.dumps({"status": "success", "data": {"count": 42}}))
`;
    const result = await executePython(db, script, []);
    expect(result.exitCode).toBe(0);
    expect(result.outputValid).toBe(true);
    expect(result.parsedOutput?.status).toBe('success');
    expect(result.parsedOutput?.data.count).toBe(42);
  });

  it('4. Deve injetar vault secrets como variáveis de ambiente REDBUS_*', async () => {
    saveSecret(db, 'jira-1', 'jira', 'my-secret-jira-token');

    const script = `
import os, json
token = os.environ.get('REDBUS_JIRA', '')
print(json.dumps({"status": "success", "data": token}))
`;
    const result = await executePython(db, script, ['jira']);
    expect(result.exitCode).toBe(0);
    expect(result.outputValid).toBe(true);
    expect(result.parsedOutput?.data).toBe('my-secret-jira-token');
  });

  it('5. NÃO deve injetar secrets que não foram solicitados', async () => {
    saveSecret(db, 'gh-1', 'github', 'gh-secret');
    saveSecret(db, 'jira-1', 'jira', 'jira-secret');

    const script = `
import os, json
gh = os.environ.get('REDBUS_GITHUB', 'none')
jira = os.environ.get('REDBUS_JIRA', 'none')
print(json.dumps({"status": "success", "data": {"gh": gh, "jira": jira}}))
`;
    const result = await executePython(db, script, ['jira']);
    expect(result.exitCode).toBe(0);
    expect(result.parsedOutput?.data.gh).toBe('none');
    expect(result.parsedOutput?.data.jira).toBe('jira-secret');
  });

  it('6. Deve passar args via sys.argv[1] como JSON', async () => {
    const script = `
import sys, json
args = json.loads(sys.argv[1])
print(json.dumps({"status": "success", "data": args}))
`;
    const result = await executePython(db, script, [], { project: 'REDBUS', limit: '10' });
    expect(result.exitCode).toBe(0);
    expect(result.outputValid).toBe(true);
    expect(result.parsedOutput?.data.project).toBe('REDBUS');
    expect(result.parsedOutput?.data.limit).toBe('10');
  });

  it('7. Deve marcar outputValid=false quando stdout não é JSON válido', async () => {
    const result = await executePython(db, 'print("not json")', []);
    expect(result.exitCode).toBe(0);
    expect(result.outputValid).toBe(false);
    expect(result.parsedOutput).toBeUndefined();
  });

  it('7.1. Deve injetar a variável REDBUS_DB_PATH no ambiente python', async () => {
    const script = `
import os, json
db_path = os.environ.get('REDBUS_DB_PATH', 'none')
print(json.dumps({"status": "success", "data": db_path}))
`;
    const result = await executePython(db, script, []);
    expect(result.exitCode).toBe(0);
    expect(result.outputValid).toBe(true);
    // Since we initialized via initializeDatabase(':memory:'), the path should match whatever db.name is.
    expect(result.parsedOutput?.data).toBe(db.name);
  });

  it('8. Deve funcionar com script vazio (sem output)', async () => {
    const result = await executePython(db, '# empty script\npass', []);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.outputValid).toBe(false);
  });
});

