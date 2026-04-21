/**
 * Generic (non-browser) tool dispatch — `read_file` and `exec`, resolved
 * from the plugin registry. `isDangerousCommand` stays as the pre-gate
 * for `exec` until the plugin owns its own `before_tool_call` hook.
 */
import { getTool } from '../../plugins/registry';
import { isDangerousCommand } from '../forgeService';

const READ_FILE_BYTES = 20000;
const EXEC_STDOUT_BYTES = 10000;
const EXEC_STDERR_BYTES = 5000;

interface GenericToolCtx {
  db: any;
  skillName?: string;
}

export async function execGenericTool(
  ctx: GenericToolCtx,
  toolCall: { id?: string; name: string; args: any },
): Promise<string | null> {
  if (toolCall.name === 'read_file') {
    const tool = getTool('read_file');
    if (!tool) return 'read_file tool not registered';
    const result = await tool.execute(toolCall.id || null, toolCall.args, {
      db: ctx.db,
      skill: ctx.skillName ? { name: ctx.skillName } : undefined,
    }) as any;
    if (result?.error) return `read_file error: ${result.error}`;
    return `${result.path} (${result.bytes} bytes):\n${String(result.content).substring(0, READ_FILE_BYTES)}`;
  }

  if (toolCall.name === 'exec') {
    const command = toolCall.args?.command || '';
    if (isDangerousCommand(command)) {
      return `BLOCKED: Command "${command}" was flagged as potentially dangerous. Use request_explicit_human_consent first, then retry.`;
    }
    const tool = getTool('exec');
    if (!tool) return 'exec tool not registered';
    const result = await tool.execute(toolCall.id || null, toolCall.args, {
      db: ctx.db,
      skill: ctx.skillName ? { name: ctx.skillName } : undefined,
    }) as any;
    if (result?.blocked) return result.reason;
    const parts = [`Exit code: ${result.exit_code}`, `Duration: ${result.duration_ms}ms`];
    if (result.timed_out) parts.push('⚠️ TIMED OUT');
    if (result.stdout) parts.push(`stdout:\n${String(result.stdout).substring(0, EXEC_STDOUT_BYTES)}`);
    if (result.stderr) parts.push(`stderr:\n${String(result.stderr).substring(0, EXEC_STDERR_BYTES)}`);
    return parts.join('\n');
  }

  return null;
}

