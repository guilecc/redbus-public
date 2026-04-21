/**
 * Thin orchestrator over the plugin registry. Provider quirks live in
 * `electron/plugins/providers/*`; this file only:
 *  - Loads ProviderConfigs from the DB.
 *  - Builds the system prompt (user profile + language directive).
 *  - Delegates to the matching ProviderPlugin via `getProviderForModel`.
 */
import { getLanguagePromptDirective } from '../database';
import { logActivity } from './activityLogger';
import { loadBuiltins } from '../plugins/registry';
import type { PluginMessage } from '../plugins/types';
import { WORKER_TOOL_SCHEMAS, WORKER_SYSTEM_MESSAGE_TEMPLATE } from '../plugins/worker-tools';
import { chatWithRole, resolveRole, type RoleName } from './roles';

loadBuiltins();

function buildUserProfile(db: any): string {
  let userProfileStr = '';
  try {
    const profile = db.prepare("SELECT system_prompt_compiled FROM UserProfile WHERE id = 'default'").get();
    if (profile && profile.system_prompt_compiled) {
      userProfileStr = `\n--- USER PROFILE CONTEXT ---\n${profile.system_prompt_compiled}\n---------------------------\n`;
    }
  } catch { /* ignore */ }
  userProfileStr += getLanguagePromptDirective(db);
  return userProfileStr;
}

export async function extractDataFromDOM(db: any, domText: string, instruction: string): Promise<string> {
  const binding = resolveRole(db, 'executor');
  logActivity('orchestrator', `[Worker/Vision] Extraindo dados com ${binding.model}`);

  const trimmedDom = (domText || '').trim();
  if (trimmedDom.length < 50) {
    console.warn(`[extractDataFromDOM] DOM text too short (${trimmedDom.length} chars), returning NO_DATA`);
    return JSON.stringify({ status: 'NO_DATA_FOUND', reason: 'Page content was empty or too short to extract meaningful data.' });
  }

  const userProfileStr = buildUserProfile(db);
  const systemPrompt = `You are a strict data extraction worker. ${userProfileStr}
Follow the user instruction to extract data from the provided DOM text.
You MUST reply with ONLY a valid JSON object. No markdown wrapping, no extra text, just the raw JSON.

CRITICAL RULES:
- ONLY extract data that is ACTUALLY PRESENT in the DOM text below.
- If the DOM text does not contain the requested information, return: {"status": "NO_DATA_FOUND", "reason": "description of what was found instead"}
- NEVER invent, fabricate, or hallucinate data. If you cannot find emails, names, dates, or any specific content in the DOM, say so.
- If the page appears to be a login page, error page, or loading screen, return: {"status": "NO_DATA_FOUND", "reason": "Page is a login/error/loading screen"}`;

  const userPrompt = `Instruction: ${instruction}\n\nDOM Content:\n${trimmedDom.substring(0, 40000)}`;

  const result = await chatWithRole(db, 'executor', {
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    responseFormat: 'json_object',
  });
  return result.content || '';
}

export async function callWorkerRaw(db: any, systemPrompt: string, userPrompt: string): Promise<string> {
  return callRoleRaw(db, 'executor', systemPrompt, userPrompt);
}

/**
 * Raw chat via an arbitrary named role. Used by long-context jobs (e.g. the
 * comms digest) that want to run on a local/cheaper binding like `digest`
 * or `utility` without silently falling back when the role isn't configured.
 */
export async function callRoleRaw(
  db: any,
  role: RoleName,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const binding = resolveRole(db, role);
  logActivity('orchestrator', `[${role}/Raw] Executando análise com ${binding.model}`);

  const result = await chatWithRole(db, role, {
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return result.content || '';
}

export async function runWorkerStep(db: any, messages: PluginMessage[]): Promise<any> {
  const binding = resolveRole(db, 'executor');
  logActivity('orchestrator', `[Worker/Step] Ferramenta (loop) via ${binding.model}`);

  const userProfileStr = buildUserProfile(db);
  const systemPrompt = WORKER_SYSTEM_MESSAGE_TEMPLATE(userProfileStr);

  const result = await chatWithRole(db, 'executor', {
    systemPrompt,
    messages,
    tools: WORKER_TOOL_SCHEMAS,
  });

  if (result.tool_calls && result.tool_calls.length > 0) {
    return { tool_calls: result.tool_calls };
  }
  return { content: result.content };
}

