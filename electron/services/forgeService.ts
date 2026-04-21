/**
 * ForgeService — Generic shell execution for the Skill playbook runtime.
 *
 * Skills are Markdown playbooks (see `skillsLoader.ts`). The LLM drives
 * execution step-by-step via the `exec` tool, so this module is intentionally
 * thin: a single `executeCommand(db, command, opts)` plus the dangerous-
 * pattern guard.
 *
 * Security:
 *   - 30 s timeout, 1 MB output buffer
 *   - `isDangerousCommand` flags destructive patterns; the worker gates them
 *     behind `request_explicit_human_consent` before calling us
 *   - Env is minimal by default; skill env vars are injected only when the
 *     caller passes `opts.env`
 */

import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { getSecretsByServices } from './vaultService';

// ── Types ─────────────────────────────────────────────────────────────

export interface ForgeExecResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
}

export interface ExecuteCommandOptions {
  cwd?: string;
  timeout_ms?: number;
  /** Extra env vars merged on top of the minimal sandbox env (e.g. skill secrets). */
  env?: Record<string, string>;
}

// ── Constants ─────────────────────────────────────────────────────────

const EXEC_TIMEOUT_MS = 30_000;
const EXEC_MAX_BUFFER = 1024 * 1024;
const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force)\b/,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bchmod\s+777\b/,
  /\b>(\/etc|\/usr|\/bin|\/sbin)\b/,
];

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(command));
}

// ── Env resolution ────────────────────────────────────────────────────

/**
 * Resolves env vars declared in a skill's frontmatter `metadata.requires.env`
 * from the vault. The vault's `service_name` column is matched verbatim to
 * the env var name (case-sensitive), so a skill requiring `JIRA_API_TOKEN`
 * looks up a vault entry stored under `service_name = 'JIRA_API_TOKEN'`.
 */
export function resolveSkillEnv(db: any, names: string[] | undefined): Record<string, string> {
  if (!names || names.length === 0) return {};
  return getSecretsByServices(db, names);
}

// ── Generic shell execution ───────────────────────────────────────────

/**
 * Runs `/bin/sh -c command` with a minimal sandbox env. Extra env vars
 * (e.g. resolved skill secrets) are merged via `opts.env`. When `opts.cwd`
 * is omitted, a throw-away tmp dir is used so commands don't accidentally
 * write into the project root.
 */
export async function executeCommand(
  _db: any,
  command: string,
  options?: ExecuteCommandOptions,
): Promise<ForgeExecResult> {
  const timeoutMs = Math.min(options?.timeout_ms || EXEC_TIMEOUT_MS, EXEC_TIMEOUT_MS);

  let cwd = options?.cwd;
  let cleanupTmp = false;
  if (!cwd) {
    cwd = path.join(os.tmpdir(), `redbus-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fsp.mkdir(cwd, { recursive: true });
    cleanupTmp = true;
  }

  const env: Record<string, string> = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME || cwd,
    LANG: process.env.LANG || 'en_US.UTF-8',
    TMPDIR: os.tmpdir(),
    ...(options?.env || {}),
  };

  const startTime = Date.now();
  let timedOut = false;

  const result = await new Promise<{ stdout: string; stderr: string; exit_code: number | null }>((resolve) => {
    execFile('/bin/sh', ['-c', command], { env, cwd, timeout: timeoutMs, maxBuffer: EXEC_MAX_BUFFER }, (error, stdout, stderr) => {
      if (error && (error as any).killed) timedOut = true;
      resolve({
        stdout: (stdout || '').substring(0, EXEC_MAX_BUFFER),
        stderr: (stderr || '').substring(0, EXEC_MAX_BUFFER),
        exit_code: error ? ((error as any).code ?? 1) : 0,
      });
    });
  });

  const duration_ms = Date.now() - startTime;
  if (cleanupTmp) await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});

  return { ...result, duration_ms, timed_out: timedOut };
}

