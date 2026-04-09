/**
 * WorkerLoop — MCP-like intelligent browser navigator for the Maestro.
 *
 * The LLM controls Playwright via tool-calling:
 * snapshot → decide → click/type/scroll → snapshot → repeat → commit
 *
 * Same architecture as intelligentExtractor.ts, but with full Forge tools
 * (snippets, exec) and HITL consent gates.
 */

import { BrowserWindow } from 'electron';
import { browseSnapshot, browseClick, browseType, browsePressKey } from './playwrightService';
import { runWorkerStep } from './llmService';
import { writeSnippet, readSnippet, listSnippets, isDangerousCommand, executeCommand } from './forgeService';

const consentResolvers = new Map<string, (response: { status: string; human_verification_layer: string }) => void>();
let consentCounter = 0;

export function resolveHumanConsent(requestId: string, approved: boolean): boolean {
  const resolver = consentResolvers.get(requestId);
  if (!resolver) return false;
  resolver({
    status: approved ? 'APPROVED' : 'DENIED',
    human_verification_layer: approved ? 'PASSED' : 'BLOCKED'
  });
  consentResolvers.delete(requestId);
  return true;
}

/* ── Browser Tool Execution ── */

async function _execBrowserTool(sessionId: string, toolCall: { name: string; args: any }): Promise<string | null> {
  switch (toolCall.name) {
    case 'browser_snapshot': {
      const snap = await browseSnapshot(sessionId);
      return `Page snapshot:\n${snap.substring(0, 20000)}`;
    }
    case 'browser_click': {
      const result = await browseClick(sessionId, toolCall.args.ref);
      const snap = await browseSnapshot(sessionId);
      return `${result}.\nNew snapshot:\n${snap.substring(0, 20000)}`;
    }
    case 'browser_type': {
      const result = await browseType(sessionId, toolCall.args.text, toolCall.args.ref);
      if (toolCall.args.submit) await browsePressKey(sessionId, 'Enter');
      const snap = await browseSnapshot(sessionId);
      return `${result}${toolCall.args.submit ? ' + Enter' : ''}.\nNew snapshot:\n${snap.substring(0, 20000)}`;
    }
    case 'browser_press_key': {
      await browsePressKey(sessionId, toolCall.args.key);
      const snap = await browseSnapshot(sessionId);
      return `Pressed ${toolCall.args.key}.\nNew snapshot:\n${snap.substring(0, 20000)}`;
    }
    case 'browser_scroll_down': {
      await browsePressKey(sessionId, 'PageDown');
      const snap = await browseSnapshot(sessionId);
      return `Scrolled down.\nNew snapshot:\n${snap.substring(0, 20000)}`;
    }
    case 'browser_scroll_up': {
      await browsePressKey(sessionId, 'PageUp');
      const snap = await browseSnapshot(sessionId);
      return `Scrolled up.\nNew snapshot:\n${snap.substring(0, 20000)}`;
    }
    case 'request_user_authentication':
      return 'Authentication not available in headless Playwright. Use FORMAT I for Outlook/Teams.';
    default:
      return null; // not a browser tool
  }
}

/**
 * Execute the intelligent worker loop on a Playwright session.
 * LLM has full control: browser navigation + Forge tools + HITL consent.
 */
export async function executeWorkerOnView(db: any, sessionId: string, instruction: string, mainWindow?: BrowserWindow): Promise<any> {
  const initialSnapshot = await browseSnapshot(sessionId);
  console.log(`[WorkerLoop] 🧠 Starting intelligent navigation: "${instruction.substring(0, 80)}..."`);

  const messages: any[] = [{
    role: 'user',
    content: `You are an intelligent browser agent with full navigation capabilities.

Instruction: ${instruction}

Current page snapshot (accessibility tree):
${initialSnapshot.substring(0, 20000)}

SNAPSHOT FORMAT:
The snapshot is an accessibility tree. Interactive elements have [ref=eN] markers.
Use these refs with tools: browser_click(ref="e5"), browser_type(ref="e3", text="hello").

TOOLS:
- browser_snapshot: Get fresh page state
- browser_click(ref="eN"): Click element by ref
- browser_type(ref="eN", text="...", submit=true/false): Type into element
- browser_press_key(key): Press keyboard key (Enter, Tab, Escape, etc.)
- browser_scroll_down / browser_scroll_up: Scroll the page
- commit_extracted_data(data): Submit your final result
- forge_exec(command): Run a shell command
- forge_write_snippet / forge_read_snippet / forge_list_snippets: Manage code snippets

Navigate intelligently: click links, fill forms, scroll to find content.
When you have the information needed, call commit_extracted_data with the result.
If the data is already visible, commit immediately — don't waste steps.`
  }];

  let isRunning = true;
  let finalData = null;
  let stepCount = 0;
  const maxSteps = 25;

  while (isRunning && stepCount < maxSteps) {
    stepCount++;
    console.log(`[WorkerLoop] Step ${stepCount}/${maxSteps}`);
    const response = await runWorkerStep(db, messages);

    if (!response.tool_calls) {
      if (response.content) finalData = response.content;
      isRunning = false;
      break;
    }

    const toolCall = response.tool_calls[0];
    messages.push({ role: 'assistant', content: response.content || `Calling ${toolCall.name}` });

    let toolOutput = '';

    // Try browser tools first
    const browserResult = await _execBrowserTool(sessionId, toolCall);
    if (browserResult !== null) {
      toolOutput = browserResult;

    } else if (toolCall.name === 'request_explicit_human_consent') {
      const requestId = `consent-${++consentCounter}`;
      const reason = toolCall.args.reason_for_consent || 'Unknown reason';
      const action = toolCall.args.intended_action || 'Unknown action';
      console.log(`[WorkerLoop] HITL consent: ${reason} → ${action}`);

      if (mainWindow) {
        mainWindow.webContents.send('hitl-consent-request', { requestId, reason, action });
        const consentResponse = await new Promise<{ status: string; human_verification_layer: string }>((resolve) => {
          consentResolvers.set(requestId, resolve);
          setTimeout(() => {
            if (consentResolvers.has(requestId)) {
              consentResolvers.delete(requestId);
              resolve({ status: 'DENIED', human_verification_layer: 'TIMEOUT' });
            }
          }, 120000);
        });
        toolOutput = `Human consent: ${JSON.stringify(consentResponse)}`;
        if (consentResponse.status === 'DENIED') {
          finalData = { status: 'BLOCKED_BY_HUMAN', reason };
          isRunning = false;
        }
      } else {
        toolOutput = `Human consent: {"status": "APPROVED", "human_verification_layer": "PASSED"}`;
      }

    } else if (toolCall.name === 'commit_extracted_data') {
      finalData = toolCall.args.data;
      isRunning = false;
      toolOutput = 'Data committed.';

      // ── Forge Tools ──
    } else if (toolCall.name === 'forge_write_snippet') {
      const snippet = writeSnippet(db, {
        name: toolCall.args.name,
        language: toolCall.args.language,
        code: toolCall.args.code,
        description: toolCall.args.description,
        tags: toolCall.args.tags,
      });
      toolOutput = `Snippet "${snippet.name}" saved (id=${snippet.id}, language=${snippet.language}).`;

    } else if (toolCall.name === 'forge_read_snippet') {
      const snippet = readSnippet(db, toolCall.args.name);
      if (snippet) {
        toolOutput = `Snippet "${snippet.name}" (${snippet.language}):\n\`\`\`${snippet.language}\n${snippet.code}\n\`\`\`\nDescription: ${snippet.description || 'none'}\nTags: ${snippet.tags.join(', ') || 'none'}\nUsed ${snippet.use_count} times.`;
      } else {
        toolOutput = `Snippet "${toolCall.args.name}" not found.`;
      }

    } else if (toolCall.name === 'forge_list_snippets') {
      const snippets = listSnippets(db, {
        language: toolCall.args.language,
        tag: toolCall.args.tag,
      });
      if (snippets.length === 0) {
        toolOutput = 'No snippets found.';
      } else {
        toolOutput = `Found ${snippets.length} snippets:\n` + snippets.map(s =>
          `- ${s.name} (${s.language}) — ${s.description || 'no description'} [used ${s.use_count}x]`
        ).join('\n');
      }

    } else if (toolCall.name === 'forge_exec') {
      const command = toolCall.args.command;
      // Security: block dangerous commands unless human approves
      if (isDangerousCommand(command)) {
        toolOutput = `BLOCKED: Command "${command}" was flagged as potentially dangerous. Use request_explicit_human_consent first, then retry.`;
      } else {
        console.log(`[WorkerLoop] forge_exec: ${command}`);
        const result = await executeCommand(db, command, {
          timeout_ms: toolCall.args.timeout_ms,
        });
        const parts = [`Exit code: ${result.exit_code}`, `Duration: ${result.duration_ms}ms`];
        if (result.timed_out) parts.push('⚠️ TIMED OUT');
        if (result.stdout) parts.push(`stdout:\n${result.stdout.substring(0, 10000)}`);
        if (result.stderr) parts.push(`stderr:\n${result.stderr.substring(0, 5000)}`);
        toolOutput = parts.join('\n');
      }
    }

    messages.push({ role: 'user', content: toolOutput });
  }

  if (!finalData) {
    throw new Error(`Worker could not complete after ${maxSteps} steps.`);
  }

  console.log(`[WorkerLoop] ✅ Completed in ${stepCount} steps`);
  return finalData;
}
