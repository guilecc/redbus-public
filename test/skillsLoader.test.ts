import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => '') },
    safeStorage: null,
}));

import { initializeDatabase, factoryReset } from '../electron/database';
import {
    setSkillsRoot,
    writeSkill,
    readSkill,
    listSkills,
    deleteSkill,
    reindexSkills,
    buildAvailableSkillsPrompt,
} from '../electron/services/skillsLoader';

describe('SkillsLoader — Markdown playbooks (OC-style)', () => {
    let db: ReturnType<typeof initializeDatabase>;
    let tmpRoot: string;

    beforeEach(() => {
        db = initializeDatabase(':memory:');
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redbus-skills-test-'));
        setSkillsRoot(tmpRoot);
    });

    afterEach(() => {
        db.close();
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        setSkillsRoot(path.join(os.homedir(), '.redbus', 'skills'));
    });

    it('1. writeSkill cria SKILL.md com YAML frontmatter e body', () => {
        const rec = writeSkill({
            name: 'fetch_jira_tickets',
            description: 'Fetches open Jira tickets from the REST API',
            body: '# fetch_jira_tickets\n\n## Steps\n1. curl the API.\n',
            metadata: { emoji: '🎫', requires: { env: ['JIRA_TOKEN'], bins: ['curl', 'jq'] } },
        });

        expect(rec.dir).toBe(path.join(tmpRoot, 'fetch_jira_tickets'));
        expect(fs.existsSync(rec.bodyPath)).toBe(true);
        const raw = fs.readFileSync(rec.bodyPath, 'utf-8');
        expect(raw).toContain('name: fetch_jira_tickets');
        expect(raw).toContain('JIRA_TOKEN');
        expect(raw).toContain('## Steps');
    });

    it('2. readSkill retorna frontmatter parseado e body', () => {
        writeSkill({
            name: 'check_github',
            description: 'Check GitHub PRs',
            body: '# check_github\n\nLists open PRs.\n',
            metadata: { requires: { env: ['GITHUB_TOKEN'] } },
        });

        const rec = readSkill('check_github');
        expect(rec).not.toBeNull();
        expect(rec!.frontmatter.name).toBe('check_github');
        expect(rec!.frontmatter.description).toBe('Check GitHub PRs');
        expect(rec!.frontmatter.metadata?.requires?.env).toEqual(['GITHUB_TOKEN']);
        expect(rec!.body).toContain('Lists open PRs');
    });

    it('3. readSkill lista arquivos auxiliares em scripts/references/assets', () => {
        const rec = writeSkill({ name: 'with_aux', description: 'aux test' });
        fs.mkdirSync(path.join(rec.dir, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(rec.dir, 'scripts', 'main.py'), 'print("x")');
        fs.mkdirSync(path.join(rec.dir, 'references'), { recursive: true });
        fs.writeFileSync(path.join(rec.dir, 'references', 'api.md'), '# docs');
        fs.mkdirSync(path.join(rec.dir, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(rec.dir, 'assets', 'template.txt'), 't');

        const read = readSkill('with_aux');
        expect(read!.scripts).toContain('main.py');
        expect(read!.references).toContain('api.md');
        expect(read!.assets).toContain('template.txt');
    });

    it('4. readSkill retorna null para skill inexistente', () => {
        expect(readSkill('nonexistent')).toBeNull();
    });

    it('5. deleteSkill remove o diretório da skill', () => {
        writeSkill({ name: 'to_delete', description: 'temp' });
        expect(fs.existsSync(path.join(tmpRoot, 'to_delete'))).toBe(true);
        expect(deleteSkill('to_delete')).toBe(true);
        expect(fs.existsSync(path.join(tmpRoot, 'to_delete'))).toBe(false);
        expect(readSkill('to_delete')).toBeNull();
    });

    it('6. listSkills lista todas as skills (via SkillsIndex após reindex)', () => {
        writeSkill({ name: 'skill_a', description: 'A' });
        writeSkill({ name: 'skill_b', description: 'B' });

        reindexSkills(db);
        const rows = db.prepare('SELECT name FROM SkillsIndex ORDER BY name ASC').all() as Array<{ name: string }>;
        expect(rows.map(r => r.name)).toEqual(['skill_a', 'skill_b']);

        const indexed = listSkills(db);
        expect(indexed).toHaveLength(2);
        expect(indexed.map(s => s.name).sort()).toEqual(['skill_a', 'skill_b']);
    });

    it('7. reindexSkills remove entradas órfãs do SkillsIndex', () => {
        writeSkill({ name: 'transient', description: 'x' });
        reindexSkills(db);
        expect(listSkills(db)).toHaveLength(1);

        deleteSkill('transient');
        reindexSkills(db);
        expect(listSkills(db)).toHaveLength(0);
    });

    it('8. buildAvailableSkillsPrompt gera prompt com skills disponíveis', () => {
        writeSkill({
            name: 'jira_check',
            description: 'Check Jira tickets',
            metadata: { emoji: '🎫' },
        });
        reindexSkills(db);

        const prompt = buildAvailableSkillsPrompt(db);
        expect(prompt).toContain('jira_check');
        expect(prompt).toContain('Check Jira tickets');
        expect(prompt).toContain('🎫');
    });

    it('9. buildAvailableSkillsPrompt retorna string vazia quando não há skills', () => {
        expect(buildAvailableSkillsPrompt(db)).toBe('');
    });

    it('10. writeSkill rejeita nomes inválidos (uppercase, espaços)', () => {
        expect(() => writeSkill({ name: 'InvalidName', description: 'x' })).toThrow();
        expect(() => writeSkill({ name: 'bad name', description: 'x' })).toThrow();
    });

    it('11. SkillsIndex é limpo no factoryReset', () => {
        writeSkill({ name: 'reset_test', description: 'x' });
        reindexSkills(db);
        const before = db.prepare('SELECT COUNT(*) as c FROM SkillsIndex').get() as any;
        expect(before.c).toBe(1);

        factoryReset(db, '/tmp/nonexistent-redbus');
        const after = db.prepare('SELECT COUNT(*) as c FROM SkillsIndex').get() as any;
        expect(after.c).toBe(0);
    });
});

