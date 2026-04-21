/**
 * `spawn_subagent` tool (Spec 06 — Phase 4, opt-in).
 *
 * Lets a planner delegate an isolated subtask to a worker with a restricted
 * tool allowlist. Runs a minimal in-process agent loop using `chatWithRole`
 * and dispatches tool calls through the plugin registry. Depth is tracked in
 * `ToolContext.agentDepth`; `MAX_SUBAGENT_DEPTH` guards against runaway
 * recursion.
 *
 * Registration is gated by the `enableSubagents` flag in `AppSettings` — when
 * the flag is off, the tool is not exposed in `listTools()` and therefore not
 * offered to any LLM.
 */
import type { ToolPlugin, PluginMessage, PluginToolSchema, ToolContext } from './types';
import { pluginApi, listTools, getTool } from './registry';
import { chatWithRole, type RoleName } from '../services/roles';
import { getAppSetting } from '../database';

export const MAX_SUBAGENT_DEPTH = 2;
const MAX_STEPS = 10;
const SPAWN_SUBAGENT_NAME = 'spawn_subagent';
const DEFAULT_SUBAGENT_SYSTEM =
  'You are an isolated subagent. Complete the requested subtask using only the tools you were granted. '
  + 'When finished, reply with plain text summarizing the result — no tool call.';

function allowedToolSchemas(allowlist?: string[]): PluginToolSchema[] {
  const tools = listTools().filter(t => t.name !== SPAWN_SUBAGENT_NAME);
  const filtered = allowlist && allowlist.length > 0
    ? tools.filter(t => allowlist.includes(t.name))
    : tools;
  return filtered.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters || { type: 'object', properties: {} },
  }));
}

async function runSubagentLoop(
  db: any,
  role: RoleName,
  instruction: string,
  allowlist: string[] | undefined,
  childDepth: number,
  parentRequestId: string | null | undefined,
): Promise<string> {
  const tools = allowedToolSchemas(allowlist);
  const messages: PluginMessage[] = [{ role: 'user', content: instruction }];
  let lastText = '';

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await chatWithRole(db, role, {
      systemPrompt: DEFAULT_SUBAGENT_SYSTEM,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });

    if (!result.tool_calls || result.tool_calls.length === 0) {
      lastText = (result.content || '').trim();
      break;
    }

    messages.push({ role: 'assistant', tool_calls: result.tool_calls });
    for (const call of result.tool_calls) {
      const plugin = getTool(call.name);
      let toolResult: any;
      if (!plugin) {
        toolResult = { error: `tool '${call.name}' not available in subagent` };
      } else {
        const ctx: ToolContext = {
          db,
          requestId: parentRequestId ?? null,
          agentDepth: childDepth,
        };
        try {
          toolResult = await plugin.execute(call.id ?? null, call.args ?? {}, ctx);
        } catch (e) {
          toolResult = { error: String(e) };
        }
      }
      messages.push({
        role: 'tool',
        name: call.name,
        tool_call_id: call.id,
        content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
      });
    }
  }

  return lastText || '[subagent terminated without a final message]';
}

export function createSpawnSubagentTool(): ToolPlugin {
  return {
    name: SPAWN_SUBAGENT_NAME,
    label: 'spawn_subagent',
    description: 'Delegate an isolated subtask to a worker agent with a limited tool allowlist.',
    parameters: {
      type: 'object',
      required: ['instruction'],
      properties: {
        instruction: { type: 'string', description: 'What the subagent should accomplish.' },
        role: { type: 'string', enum: ['executor', 'utility'], description: 'Role binding the subagent runs under (default: executor).' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tool names the subagent may call. Defaults to all non-subagent tools.' },
      },
    },
    execute: async (_toolCallId, params, ctx) => {
      const parentDepth = typeof ctx.agentDepth === 'number' ? ctx.agentDepth : 0;
      if (parentDepth >= MAX_SUBAGENT_DEPTH) {
        return { error: 'max subagent depth reached' };
      }
      const role: RoleName = params?.role === 'utility' ? 'utility' : 'executor';
      const instruction = String(params?.instruction ?? '').trim();
      if (!instruction) return { error: 'instruction is required' };
      const allowlist = Array.isArray(params?.tools) ? params.tools.map(String) : undefined;
      try {
        const output = await runSubagentLoop(
          ctx.db,
          role,
          instruction,
          allowlist,
          parentDepth + 1,
          ctx.requestId ?? null,
        );
        return { output };
      } catch (e) {
        return { error: String(e) };
      }
    },
  };
}

/**
 * Register or unregister the `spawn_subagent` tool based on the
 * `enableSubagents` flag in AppSettings. Safe to call multiple times.
 */
export function syncSpawnSubagentTool(db: any): void {
  const enabled = db ? getAppSetting(db, 'enableSubagents') === 'true' : false;
  if (enabled) {
    pluginApi.registerTool(createSpawnSubagentTool());
  } else {
    pluginApi.unregisterTool(SPAWN_SUBAGENT_NAME);
  }
}

