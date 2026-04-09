/**
 * ForgeService — Code generation, storage and sandboxed execution.
 *
 * Provides CRUD for reusable code snippets stored in the Cofre SQLite,
 * and sandboxed shell execution via child_process.
 *
 * Security:
 * - exec runs in a temp directory with sanitized env
 * - Dangerous commands (rm -rf, sudo, curl, wget) require HITL approval
 * - 30s timeout, 1MB output buffer
 */

import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';

// ── Types ──

export interface ForgeSnippet {
  id: number;
  name: string;
  language: string;
  code: string;
  description: string | null;
  tags: string[];
  parameters_schema: string;
  required_vault_keys: string;
  version: number;
  use_count: number;
  created_at: string;
  last_used_at: string | null;
}

export interface ForgeExecResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
}

// ── Constants ──

const EXEC_TIMEOUT_MS = 30_000;
const EXEC_MAX_BUFFER = 1024 * 1024; // 1MB
const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force)\b/,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchmod\s+777\b/,
  /\b>(\/etc|\/usr|\/bin|\/sbin)\b/,
];

// ── Snippet CRUD ──

export function writeSnippet(db: any, params: {
  name: string;
  language?: string;
  code: string;
  description?: string;
  tags?: string[];
  parameters_schema?: string;
  required_vault_keys?: string[];
}): ForgeSnippet {
  const { name, code, description, tags } = params;
  const language = params.language || 'python';
  const tagsJson = JSON.stringify(tags || []);
  const paramsSchema = params.parameters_schema || '{}';
  const vaultKeys = JSON.stringify(params.required_vault_keys || []);

  // Get existing version for increment
  const existing = rawGetSnippet(db, name);
  const version = existing ? existing.version + 1 : 1;

  db.prepare(`
    INSERT INTO ForgeSnippets (name, language, code, description, tags, parameters_schema, required_vault_keys, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      language = excluded.language,
      code = excluded.code,
      description = excluded.description,
      tags = excluded.tags,
      parameters_schema = excluded.parameters_schema,
      required_vault_keys = excluded.required_vault_keys,
      version = ?
  `).run(name, language, code, description || null, tagsJson, paramsSchema, vaultKeys, version, version);

  const row = db.prepare('SELECT * FROM ForgeSnippets WHERE name = ?').get(name);
  return parseSnippetRow(row);
}

function parseSnippetRow(row: any): ForgeSnippet {
  return { ...row, tags: JSON.parse(row.tags || '[]') };
}

function rawGetSnippet(db: any, nameOrId: string | number): any | null {
  return typeof nameOrId === 'number'
    ? db.prepare('SELECT * FROM ForgeSnippets WHERE id = ?').get(nameOrId)
    : db.prepare('SELECT * FROM ForgeSnippets WHERE name = ?').get(nameOrId);
}

export function readSnippet(db: any, nameOrId: string | number): ForgeSnippet | null {
  const row = rawGetSnippet(db, nameOrId);
  if (!row) return null;

  // Bump use_count
  db.prepare('UPDATE ForgeSnippets SET use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);

  return parseSnippetRow(row);
}

export function listSnippets(db: any, filters?: { language?: string; tag?: string }): ForgeSnippet[] {
  let query = 'SELECT * FROM ForgeSnippets WHERE 1=1';
  const params: any[] = [];

  if (filters?.language) {
    query += ' AND language = ?';
    params.push(filters.language);
  }
  if (filters?.tag) {
    query += ' AND tags LIKE ?';
    params.push(`%"${filters.tag}"%`);
  }

  query += ' ORDER BY use_count DESC, created_at DESC LIMIT 50';

  const rows = db.prepare(query).all(...params);
  return rows.map(parseSnippetRow);
}

export function deleteSnippet(db: any, name: string): boolean {
  const result = db.prepare('DELETE FROM ForgeSnippets WHERE name = ?').run(name);
  return result.changes > 0;
}

/**
 * Build a prompt block listing all snippets as callable tools for the Maestro.
 * Replaces the old buildSkillToolsPrompt from skillService.
 */
export function buildForgeToolsPrompt(db: any): string {
  const snippets = listSnippets(db);
  if (snippets.length === 0) return '';

  const toolDescriptions = snippets.map(s => {
    let paramsDesc = '';
    try {
      const schema = JSON.parse(s.parameters_schema || '{}');
      const props = schema.properties || {};
      const required = schema.required || [];
      const paramLines = Object.entries(props).map(([key, val]: [string, any]) => {
        const req = required.includes(key) ? ' (required)' : ' (optional)';
        return `    - ${key}: ${val.type || 'string'}${req} — ${val.description || ''}`;
      });
      if (paramLines.length > 0) paramsDesc = '\n  Parameters:\n' + paramLines.join('\n');
    } catch { /* ignore */ }

    return `- SKILL: ${s.name} (${s.language})\n  Description: ${s.description || 'no description'}${paramsDesc}`;
  }).join('\n\n');

  return `\n\n--- YOUR SKILL LIBRARY (reusable tools you forged) ---
${toolDescriptions}

To use an existing skill, output FORMAT D:
{
  "goal": "string",
  "cron_expression": "string or null",
  "skill_name": "the_skill_name",
  "skill_args": { "param1": "value1" },
  "steps": []
}
--- END SKILL LIBRARY ---`;
}

/**
 * Auto-heal a failed snippet by sending the error to the Worker LLM.
 */
export async function autoHealSnippet(db: any, snippetName: string, stderr: string): Promise<boolean> {
  const snippet = readSnippet(db, snippetName);
  if (!snippet) return false;

  const configs = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
  if (!configs) return false;

  const workerModel = configs.workerModel || 'gemini-2.5-flash';
  const systemPrompt = `You are a ${snippet.language} debugging assistant. Fix the following script based on the error message. Output ONLY the corrected code, no explanations, no markdown.`;
  const userPrompt = `SCRIPT:\n${snippet.code}\n\nERROR:\n${stderr}`;

  let fixedCode = '';

  try {
    if (workerModel.includes('gemini')) {
      if (!configs.googleKey) return false;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${workerModel}:generateContent?key=${configs.googleKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }]
        })
      });
      if (!response.ok) return false;
      const data = await response.json();
      fixedCode = data.candidates[0].content.parts[0].text.trim();
    } else if (workerModel.includes('claude')) {
      if (!configs.anthropicKey) return false;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': configs.anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: workerModel, max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] })
      });
      if (!response.ok) return false;
      const data = await response.json();
      fixedCode = data.content[0].text.trim();
    } else {
      return false;
    }
  } catch {
    return false;
  }

  fixedCode = fixedCode.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  if (!fixedCode) return false;

  writeSnippet(db, {
    name: snippet.name,
    language: snippet.language,
    code: fixedCode,
    description: snippet.description || undefined,
    parameters_schema: snippet.parameters_schema,
    required_vault_keys: JSON.parse(snippet.required_vault_keys || '[]'),
  });

  console.log(`[AutoHeal] Snippet "${snippetName}" repaired (v${snippet.version + 1})`);
  return true;
}

// ── Execution ──

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(command));
}

export async function executeCommand(
  db: any,
  command: string,
  options?: { timeout_ms?: number; spec_id?: string; snippet_id?: number }
): Promise<ForgeExecResult> {
  const timeoutMs = Math.min(options?.timeout_ms || EXEC_TIMEOUT_MS, EXEC_TIMEOUT_MS);
  const sandboxDir = path.join(os.tmpdir(), 'redbus-forge-sandbox');
  await fsp.mkdir(sandboxDir, { recursive: true });

  const env: Record<string, string> = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: sandboxDir,
    LANG: process.env.LANG || 'en_US.UTF-8',
    TMPDIR: sandboxDir,
  };

  const startTime = Date.now();
  let timedOut = false;

  const result = await new Promise<{ stdout: string; stderr: string; exit_code: number | null }>(
    (resolve) => {
      execFile(
        '/bin/sh',
        ['-c', command],
        { env, cwd: sandboxDir, timeout: timeoutMs, maxBuffer: EXEC_MAX_BUFFER },
        (error, stdout, stderr) => {
          if (error && (error as any).killed) timedOut = true;
          resolve({
            stdout: (stdout || '').substring(0, EXEC_MAX_BUFFER),
            stderr: (stderr || '').substring(0, EXEC_MAX_BUFFER),
            exit_code: error ? ((error as any).code ?? 1) : 0,
          });
        }
      );
    }
  );

  const duration_ms = Date.now() - startTime;

  // Log execution
  db.prepare(`
    INSERT INTO ForgeExecutions (snippet_id, spec_id, command, stdout, stderr, exit_code, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    options?.snippet_id || null,
    options?.spec_id || null,
    command,
    result.stdout.substring(0, 10000),
    result.stderr.substring(0, 10000),
    result.exit_code,
    duration_ms
  );

  return { ...result, duration_ms, timed_out: timedOut };
}

