import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  safeStorage: null,
}));

import { initializeDatabase, factoryReset } from '../electron/database';
import {
  writeSnippet,
  readSnippet,
  listSnippets,
  deleteSnippet,
  buildForgeToolsPrompt,
} from '../electron/services/forgeService';

describe('ForgeService — Snippet Library (replaces SkillService)', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('1. Deve salvar e recuperar um snippet por nome', () => {
    writeSnippet(db, {
      name: 'fetch_jira_tickets',
      language: 'python',
      code: 'import requests\nprint("ok")',
      description: 'Fetches open Jira tickets from the REST API',
      parameters_schema: '{"type":"object","properties":{"project":{"type":"string","description":"Jira project key"}},"required":["project"]}',
      required_vault_keys: ['jira'],
    });

    const snippet = readSnippet(db, 'fetch_jira_tickets');
    expect(snippet).toBeDefined();
    expect(snippet!.name).toBe('fetch_jira_tickets');
    expect(snippet!.description).toContain('Jira');
    expect(snippet!.code).toContain('import requests');
    expect(snippet!.version).toBe(1);
    expect(snippet!.language).toBe('python');
    expect(JSON.parse(snippet!.required_vault_keys)).toEqual(['jira']);
  });

  it('2. Deve incrementar versão ao atualizar um snippet existente', () => {
    writeSnippet(db, { name: 'my_snippet', code: 'print(1)', description: 'v1' });
    expect(readSnippet(db, 'my_snippet')!.version).toBe(1);

    writeSnippet(db, { name: 'my_snippet', code: 'print(2)', description: 'v2' });
    const updated = readSnippet(db, 'my_snippet')!;
    expect(updated.version).toBe(2);
    expect(updated.description).toBe('v2');
    expect(updated.code).toBe('print(2)');
  });

  it('3. Deve listar todos os snippets', () => {
    writeSnippet(db, { name: 'snippet_a', code: 'pass', description: 'A' });
    writeSnippet(db, { name: 'snippet_b', code: 'pass', description: 'B' });

    const snippets = listSnippets(db);
    expect(snippets).toHaveLength(2);
  });

  it('4. Deve deletar um snippet por nome', () => {
    writeSnippet(db, { name: 'to_delete', code: 'pass', description: 'temp' });
    expect(deleteSnippet(db, 'to_delete')).toBe(true);
    expect(readSnippet(db, 'to_delete')).toBeNull();
  });

  it('5. Deve retornar null para snippet inexistente', () => {
    expect(readSnippet(db, 'nonexistent')).toBeNull();
  });

  it('6. Deve gerar prompt de tools a partir dos snippets', () => {
    writeSnippet(db, {
      name: 'check_github',
      language: 'python',
      code: 'print("prs")',
      description: 'Check GitHub PRs',
      parameters_schema: '{"type":"object","properties":{"repo":{"type":"string","description":"Repository name"}},"required":["repo"]}',
      required_vault_keys: ['github'],
    });

    const prompt = buildForgeToolsPrompt(db);
    expect(prompt).toContain('SKILL: check_github');
    expect(prompt).toContain('Check GitHub PRs');
    expect(prompt).toContain('repo: string (required)');
    expect(prompt).toContain('FORMAT D');
  });

  it('7. Deve retornar string vazia quando não há snippets', () => {
    expect(buildForgeToolsPrompt(db)).toBe('');
  });

  it('8. Deve suportar múltiplas linguagens', () => {
    writeSnippet(db, { name: 's1', language: 'python', code: 'print(1)', description: 'py' });
    writeSnippet(db, { name: 's2', language: 'bash', code: 'echo hi', description: 'sh' });
    writeSnippet(db, { name: 's3', language: 'typescript', code: 'console.log(1)', description: 'ts' });

    const all = listSnippets(db);
    expect(all).toHaveLength(3);
    const languages = [...new Set(all.map(s => s.language))].sort();
    expect(languages).toEqual(['bash', 'python', 'typescript']);
  });

  it('9. ForgeSnippets deve ser limpo no factoryReset', () => {
    writeSnippet(db, { name: 'temp', code: 'pass', description: 'temp' });
    expect(listSnippets(db)).toHaveLength(1);

    factoryReset(db, '/tmp/nonexistent');
    expect(listSnippets(db)).toHaveLength(0);
  });

  it('10. Deve injetar snippets no payload do Maestro', () => {
    writeSnippet(db, {
      name: 'jira_check',
      language: 'python',
      code: 'import os\nprint(os.environ.get("REDBUS_JIRA"))',
      description: 'Check Jira tickets',
      required_vault_keys: ['jira'],
    });

    const prompt = buildForgeToolsPrompt(db);
    expect(prompt).toContain('SKILL: jira_check');
    expect(prompt).toContain('skill_name');
    expect(prompt).toContain('skill_args');
  });
});

