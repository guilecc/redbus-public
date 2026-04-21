/**
 * Browser tool dispatch — resolves each `browser_*` tool from the plugin
 * registry (see `electron/plugins/browser-tools.ts`). This keeps the
 * runner itself provider/tool-agnostic: any new browser tool registered
 * through `pluginApi.registerTool` is picked up here automatically.
 *
 * `request_user_authentication` is not a registered tool — it is a
 * compatibility stub kept for prompts that still mention it.
 */
import { getTool } from '../../plugins/registry';
import { BROWSER_TOOL_NAMES } from '../../plugins/browser-tools';

const BROWSER_TOOL_SET: Set<string> = new Set(BROWSER_TOOL_NAMES);

export async function execBrowserTool(
  sessionId: string,
  toolCall: { id?: string; name: string; args: any },
): Promise<string | null> {
  if (toolCall.name === 'request_user_authentication') {
    return 'Authentication not available in headless Playwright.';
  }

  if (!BROWSER_TOOL_SET.has(toolCall.name)) return null;

  const tool = getTool(toolCall.name);
  if (!tool) return `Browser tool '${toolCall.name}' not registered.`;

  const result = await tool.execute(toolCall.id || null, toolCall.args || {}, {
    db: null,
    browserSessionId: sessionId,
  });
  return typeof result === 'string' ? result : String(result ?? '');
}

