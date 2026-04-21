/**
 * Forge builtins — generic `read_file` and `exec` tools used by the Skill
 * playbook runtime and by subagents. Registered once at startup by
 * `registerForgeBuiltins(db)`; there is no per-skill registration anymore
 * (skills are Markdown playbooks, not typed tools).
 *
 * Both tools read the active skill context from `ctx.skill` (set by the
 * worker loop when running a FORMAT D task) to:
 *   - scope `read_file` to the skill directory (plus a small allowlist)
 *   - inject env vars declared in `metadata.requires.env` during `exec`
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ToolPlugin, ToolContext } from './types';
import { pluginApi } from './registry';
import { isDangerousCommand, executeCommand, resolveSkillEnv } from '../services/forgeService';
import { getSkillsRoot, readSkill } from '../services/skillsLoader';

const MAX_FILE_BYTES = 1024 * 1024;

function isPathAllowed(absPath: string): boolean {
  const normalized = path.resolve(absPath);
  const allowed = [
    getSkillsRoot(),
    path.join(os.tmpdir(), 'redbus-exec-'),
  ];
  return allowed.some(root => normalized === root || normalized.startsWith(root + path.sep) || normalized.startsWith(root));
}

const readFileTool: ToolPlugin = {
  name: 'read_file',
  label: 'read_file',
  description: 'Read a UTF-8 text file. Scoped to the skills directory (and tmp exec sandboxes). Use for SKILL.md playbooks, references/, assets/.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute filesystem path to read' },
    },
    required: ['path'],
  },
  execute: async (_toolCallId, params: any) => {
    const target = typeof params?.path === 'string' ? params.path : '';
    if (!target) return { error: 'path is required' };
    const abs = path.resolve(target);
    if (!isPathAllowed(abs)) return { error: `path not allowed: ${abs}` };
    if (!fs.existsSync(abs)) return { error: `file not found: ${abs}` };
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) return { error: `not a file: ${abs}` };
      if (st.size > MAX_FILE_BYTES) return { error: `file too large (${st.size} bytes, max ${MAX_FILE_BYTES})` };
      const content = fs.readFileSync(abs, 'utf-8');
      return { path: abs, bytes: st.size, content };
    } catch (e: any) {
      return { error: String(e?.message || e) };
    }
  },
};

const execTool: ToolPlugin = {
  name: 'exec',
  label: 'exec',
  description: 'Run a shell command via /bin/sh -c. 30 s timeout, 1 MB output buffer. Dangerous patterns (sudo, rm -rf) are blocked — request consent first if needed. When running inside a skill context, the skill\'s declared env vars (metadata.requires.env) are injected automatically.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run' },
      cwd: { type: 'string', description: 'Working directory (default: tmp sandbox, or the active skill dir when in a skill task)' },
      timeout_ms: { type: 'number', description: 'Timeout in milliseconds (max 30000, default 30000)' },
    },
    required: ['command'],
  },
  execute: async (_toolCallId, params: any, ctx: ToolContext) => {
    const command = typeof params?.command === 'string' ? params.command : '';
    if (!command) return { error: 'command is required' };
    if (isDangerousCommand(command)) {
      return { blocked: true, reason: `Command flagged as dangerous: "${command}". Use request_explicit_human_consent first.` };
    }

    // Resolve skill context (set by workerLoop/executeSkillTask)
    const skillName: string | undefined = ctx?.skill?.name;
    let cwd = typeof params?.cwd === 'string' ? params.cwd : undefined;
    let env: Record<string, string> | undefined;
    if (skillName) {
      const rec = readSkill(skillName);
      if (rec) {
        if (!cwd) cwd = rec.dir;
        env = resolveSkillEnv(ctx.db, rec.frontmatter.metadata?.requires?.env);
      }
    }

    const result = await executeCommand(ctx.db, command, {
      cwd,
      timeout_ms: typeof params?.timeout_ms === 'number' ? params.timeout_ms : undefined,
      env,
    });
    return result;
  },
};

export function registerForgeBuiltins(_db: any): void {
  pluginApi.registerTool(readFileTool);
  pluginApi.registerTool(execTool);
}

