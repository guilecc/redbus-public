/**
 * One ReAct attempt. The LLM drives a loop of (think → tool_call → result)
 * until it commits data, returns free text, hits `max_steps`, repeats the
 * same tool too many times, or the attempt is externally aborted.
 *
 * Extracted from `workerLoop._runLoop` + `intelligentExtractor`'s inner loop
 * as Phase 1 of Spec 09. The two callers collapsed to a single engine that
 * is **mode-aware** (browser / skill / extract / chat) and returns a typed
 * `AttemptResult` instead of `any`.
 */
import type { PluginMessage } from '../../plugins/types';
import { runWorkerStep } from '../llmService';
import { logActivity } from '../activityLogger';
import { execBrowserTool } from './browserExec';
import { execGenericTool } from './genericExec';
import { handleConsent } from './consent';
import { throwIfAborted } from './abort';
import { detectLoop } from './loopDetection';
import type {
  AgentRunParams,
  AttemptResult,
  AttemptTrace,
  AttemptTraceTurn,
  StopReason,
  ToolSummary,
} from './types';

interface RunAttemptArgs {
  db: any;
  params: AgentRunParams;
  attemptIdx: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_STEPS = 25;
const PREVIEW_BYTES = 500;

export async function runAttempt(args: RunAttemptArgs): Promise<AttemptResult> {
  const { db, params, attemptIdx, signal } = args;
  const maxSteps = params.maxSteps ?? DEFAULT_MAX_STEPS;
  const startedAt = Date.now();

  const messages: PluginMessage[] = [];
  if (params.prompt.history && params.prompt.history.length > 0) {
    messages.push(...params.prompt.history);
  }
  messages.push({ role: 'user', content: params.prompt.user });

  const turns: AttemptTraceTurn[] = [];
  const toolCounters: ToolSummary = { calls: 0, tools: [], failures: 0, totalMs: 0 };
  const pending: AttemptResult['pendingToolCalls'] = [];

  let stepCount = 0;
  let stopReason: StopReason = 'max_steps';
  let committedData: unknown | undefined;
  let finalText: string | undefined;
  let error: { kind: string; message: string } | undefined;

  while (stepCount < maxSteps) {
    stepCount++;
    try {
      throwIfAborted(signal);
    } catch (err: any) {
      stopReason = 'aborted';
      error = { kind: 'aborted', message: err?.message || 'aborted' };
      break;
    }

    logActivity('orchestrator', `[Agent] Passo ${stepCount}/${maxSteps}`);

    let response: any;
    try {
      response = await runWorkerStep(db, messages);
    } catch (err: any) {
      stopReason = 'llm_error';
      error = { kind: 'llm_error', message: err?.message || String(err) };
      break;
    }

    // LLM returned text (no tool call) — treat as final answer.
    if (!response?.tool_calls || response.tool_calls.length === 0) {
      finalText = response?.content || '';
      stopReason = 'text_final';
      turns.push({ stepIndex: stepCount, textOutputPreview: finalText?.slice(0, PREVIEW_BYTES) });
      break;
    }

    const toolCall = response.tool_calls[0];
    messages.push({
      role: 'assistant',
      content: response.content || `Calling ${toolCall.name}`,
      tool_calls: [toolCall],
    });

    // Loop detection: same tool+args repeated beyond threshold.
    const loopHit = detectLoop(turns, toolCall);
    if (loopHit) {
      stopReason = 'loop_detected';
      error = { kind: 'loop_detected', message: `Tool '${toolCall.name}' repeated ${loopHit.count}× with identical args` };
      turns.push({ stepIndex: stepCount, toolName: toolCall.name, toolArgs: toolCall.args, toolError: error.message });
      break;
    }

    logActivity('orchestrator', `[Ferramenta] Usando '${toolCall.name}' (arg: ${JSON.stringify(toolCall.args).slice(0, 150)}...)`);

    const turn: AttemptTraceTurn = { stepIndex: stepCount, toolName: toolCall.name, toolArgs: toolCall.args };
    const toolStartedAt = Date.now();
    let toolOutput: string | null = null;
    let denied = false;
    let denyReason: string | undefined;

    try {
      throwIfAborted(signal);

      if (toolCall.name === 'commit_extracted_data') {
        committedData = toolCall.args?.data;
        stopReason = 'committed';
        toolOutput = 'Data committed.';
      } else if (toolCall.name === 'request_explicit_human_consent') {
        const c = await handleConsent(toolCall, params.mainWindow);
        toolOutput = c.output;
        denied = c.denied;
        denyReason = c.reason;
      } else if (params.mode.browserSessionId) {
        const browserOut = await execBrowserTool(params.mode.browserSessionId, toolCall);
        if (browserOut !== null) {
          toolOutput = browserOut;
        }
      }

      if (toolOutput === null) {
        const generic = await execGenericTool({ db, skillName: params.mode.skillName }, toolCall);
        toolOutput = generic ?? `Unknown tool: ${toolCall.name}`;
        if (generic === null) {
          pending.push({ id: toolCall.id, name: toolCall.name, args: toolCall.args });
        }
      }
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      stopReason = aborted ? 'aborted' : 'tool_error';
      error = { kind: aborted ? 'aborted' : 'tool_error', message: err?.message || String(err) };
      turn.toolError = error.message;
      turns.push(turn);
      toolCounters.calls++;
      toolCounters.failures++;
      if (!toolCounters.tools.includes(toolCall.name)) toolCounters.tools.push(toolCall.name);
      toolCounters.totalMs += Date.now() - toolStartedAt;
      break;
    }

    const toolDurationMs = Date.now() - toolStartedAt;
    turn.toolDurationMs = toolDurationMs;
    turn.toolOutputPreview = toolOutput?.slice(0, PREVIEW_BYTES);
    turns.push(turn);

    toolCounters.calls++;
    if (!toolCounters.tools.includes(toolCall.name)) toolCounters.tools.push(toolCall.name);
    toolCounters.totalMs += toolDurationMs;

    messages.push({ role: 'tool', content: toolOutput || '', tool_call_id: toolCall.id, name: toolCall.name });

    if (stopReason === 'committed') break;
    if (denied) {
      committedData = { status: 'BLOCKED_BY_HUMAN', reason: denyReason };
      stopReason = 'committed';
      break;
    }
  }

  const trace: AttemptTrace = {
    attemptIdx,
    startedAt,
    endedAt: Date.now(),
    stopReason,
    turns,
    error,
  };

  return {
    stopReason,
    committedData,
    finalText,
    pendingToolCalls: pending && pending.length > 0 ? pending : undefined,
    trace,
    toolCounters,
    error,
  };
}

