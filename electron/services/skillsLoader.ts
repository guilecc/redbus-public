/**
 * SkillsLoader — Filesystem-backed Markdown playbooks (OC-style).
 *
 * A Skill is a directory `<skillsRoot>/<name>/` containing:
 *   - SKILL.md        (required, YAML frontmatter + markdown body = the playbook)
 *   - scripts/        (optional, helper scripts the playbook invokes via exec)
 *   - references/     (optional, docs the LLM loads on demand via read_file)
 *   - assets/         (optional, templates used by the playbook)
 *
 * Frontmatter (zod-validated):
 *   name         string, snake-case
 *   description  string
 *   homepage?    string
 *   metadata?    { emoji?, requires?: { env?: string[], bins?: string[] },
 *                   primaryEnv?, install?, ... }
 *
 * Cached in `SkillsIndex` (SQLite) so the Maestro prompt can be rebuilt
 * without re-parsing every SKILL.md on each chat turn.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { z } from 'zod';

// ── Schema ─────────────────────────────────────────────────────────────

const SkillRequiresSchema = z.object({
  env: z.array(z.string()).optional(),
  bins: z.array(z.string()).optional(),
  anyBins: z.array(z.string()).optional(),
}).passthrough();

const SkillMetadataSchema = z.object({
  emoji: z.string().optional(),
  requires: SkillRequiresSchema.optional(),
  primaryEnv: z.string().optional(),
  install: z.array(z.record(z.string(), z.any())).optional(),
  homepage: z.string().optional(),
}).passthrough();

const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_\-]+$/, 'skill name must be lowercase letters, digits, hyphens or underscores'),
  description: z.string().min(1),
  homepage: z.string().optional(),
  metadata: SkillMetadataSchema.optional(),
}).passthrough();

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface SkillRecord {
  name: string;
  description: string;
  dir: string;
  bodyPath: string;
  frontmatter: SkillFrontmatter;
  mtimeMs: number;
}

// ── Root configuration ────────────────────────────────────────────────

let _skillsRoot: string | null = null;

export function setSkillsRoot(dir: string): void {
  _skillsRoot = dir;
}

export function getSkillsRoot(): string {
  if (_skillsRoot) return _skillsRoot;
  try {
    const { app } = require('electron');
    const userData = app?.getPath?.('userData');
    if (userData) return path.join(userData, 'skills');
  } catch { /* not in electron */ }
  return path.join(os.homedir(), '.redbus', 'skills');
}

function ensureRoot(): string {
  const root = getSkillsRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

// ── Filesystem scan ───────────────────────────────────────────────────

function parseSkillDir(dir: string): SkillRecord | null {
  const bodyPath = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(bodyPath)) return null;
  try {
    const raw = fs.readFileSync(bodyPath, 'utf-8');
    const parsed = matter(raw);
    const fm = SkillFrontmatterSchema.parse(parsed.data);
    const st = fs.statSync(bodyPath);
    return {
      name: fm.name,
      description: fm.description,
      dir,
      bodyPath,
      frontmatter: fm,
      mtimeMs: st.mtimeMs,
    };
  } catch (e) {
    console.warn(`[SkillsLoader] Skipping invalid skill at ${dir}:`, (e as Error).message);
    return null;
  }
}

export function scanSkills(): SkillRecord[] {
  const root = ensureRoot();
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const skills: SkillRecord[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const rec = parseSkillDir(path.join(root, ent.name));
    if (rec) skills.push(rec);
  }
  return skills;
}

// ── SQLite cache ──────────────────────────────────────────────────────

export function reindexSkills(db: any): SkillRecord[] {
  const skills = scanSkills();
  const upsert = db.prepare(`
    INSERT INTO SkillsIndex (name, description, frontmatter_json, body_path, mtime_ms, indexed_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      description = excluded.description,
      frontmatter_json = excluded.frontmatter_json,
      body_path = excluded.body_path,
      mtime_ms = excluded.mtime_ms,
      indexed_at = CURRENT_TIMESTAMP
  `);
  const current = new Set<string>();
  for (const s of skills) {
    upsert.run(s.name, s.description, JSON.stringify(s.frontmatter), s.bodyPath, s.mtimeMs);
    current.add(s.name);
  }
  const existing = db.prepare('SELECT name FROM SkillsIndex').all() as Array<{ name: string }>;
  for (const row of existing) {
    if (!current.has(row.name)) db.prepare('DELETE FROM SkillsIndex WHERE name = ?').run(row.name);
  }
  return skills;
}

export function listSkills(db?: any): SkillRecord[] {
  if (db) {
    try {
      const rows = db.prepare('SELECT * FROM SkillsIndex ORDER BY name ASC').all() as any[];
      if (rows.length > 0) {
        return rows.map(r => ({
          name: r.name,
          description: r.description,
          dir: path.dirname(r.body_path),
          bodyPath: r.body_path,
          frontmatter: JSON.parse(r.frontmatter_json),
          mtimeMs: r.mtime_ms,
        }));
      }
    } catch { /* table may not exist during tests */ }
  }
  return scanSkills();
}

// ── Read ──────────────────────────────────────────────────────────────

function listDirEntries(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => e.name)
    .sort();
}

export interface SkillReadResult {
  frontmatter: SkillFrontmatter;
  body: string;
  dir: string;
  bodyPath: string;
  scripts: string[];
  references: string[];
  assets: string[];
}

export function readSkill(name: string): SkillReadResult | null {
  const dir = path.join(getSkillsRoot(), name);
  const bodyPath = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(bodyPath)) return null;
  const raw = fs.readFileSync(bodyPath, 'utf-8');
  const parsed = matter(raw);
  const fm = SkillFrontmatterSchema.safeParse(parsed.data);
  if (!fm.success) return null;
  return {
    frontmatter: fm.data,
    body: parsed.content,
    dir,
    bodyPath,
    scripts: listDirEntries(path.join(dir, 'scripts')),
    references: listDirEntries(path.join(dir, 'references')),
    assets: listDirEntries(path.join(dir, 'assets')),
  };
}

// ── Write ─────────────────────────────────────────────────────────────

export interface WriteSkillParams {
  name: string;
  description: string;
  body?: string;
  metadata?: SkillFrontmatter['metadata'];
  homepage?: string;
}

/**
 * Creates or overwrites a skill directory with a SKILL.md playbook.
 * Auxiliary files under `scripts/`, `references/`, `assets/` are untouched
 * — the LLM writes them separately via the `exec` tool when needed.
 */
export function writeSkill(params: WriteSkillParams): SkillRecord {
  SkillFrontmatterSchema.parse({
    name: params.name,
    description: params.description,
    metadata: params.metadata,
    homepage: params.homepage,
  });
  const dir = path.join(ensureRoot(), params.name);
  fs.mkdirSync(dir, { recursive: true });

  const frontmatter: SkillFrontmatter = {
    name: params.name,
    description: params.description,
  };
  if (params.homepage) frontmatter.homepage = params.homepage;
  if (params.metadata) frontmatter.metadata = params.metadata;

  const body = (params.body ?? `# ${params.name}\n\n${params.description}\n`).trimEnd() + '\n';
  const content = matter.stringify(body, frontmatter as any);
  const bodyPath = path.join(dir, 'SKILL.md');
  fs.writeFileSync(bodyPath, content, 'utf-8');

  const st = fs.statSync(bodyPath);
  return { name: params.name, description: params.description, dir, bodyPath, frontmatter, mtimeMs: st.mtimeMs };
}

export function deleteSkill(name: string): boolean {
  const dir = path.join(getSkillsRoot(), name);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// ── Maestro prompt section (OC-style) ─────────────────────────────────

/**
 * Emits an `<available_skills>` XML block listing the skills currently
 * on disk. The Maestro references these by name in FORMAT D (`use_skill`)
 * and the worker preloads the SKILL.md body before running the task.
 */
export function buildAvailableSkillsPrompt(db?: any): string {
  const skills = listSkills(db);
  if (skills.length === 0) return '';

  const items = skills.map(s => {
    const emoji = s.frontmatter.metadata?.emoji ? `${s.frontmatter.metadata.emoji} ` : '';
    return `  <skill>
    <name>${s.name}</name>
    <description>${emoji}${s.description}</description>
    <location>${s.dir}</location>
  </skill>`;
  }).join('\n');

  return `\n\n<available_skills>
${items}
</available_skills>

Use FORMAT D with \`use_skill\` set to the skill's \`<name>\` to follow its playbook. The worker will read SKILL.md and execute the steps described there via the \`exec\` and \`read_file\` tools.`;
}


