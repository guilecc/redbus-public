/**
 * Public contract for the unified agent runner (Spec 09).
 *
 * The runner consolidates the two ReAct entrypoints that used to live in
 * `workerLoop.ts` (`executeWorkerOnView`, `executeSkillTask`) and the loop
 * duplicated inside `intelligentExtractor.ts`.
 *
 * Separation of concerns:
 *   - `AgentRunParams` is the logical *request* (one mode, one role, one prompt).
 *   - `AgentRunResult.meta` is the tipped answer to "what happened in this run?" —
 *     the UI can show status, stop reason and tool summary without parsing logs.
 *   - `AttemptTrace` records 1 Attempt (= 1 LLM session of N turns) so a Run
 *     with provider fail-over keeps one entry per retry.
 */
import type { BrowserWindow } from 'electron';
import type { PluginMessage, PluginToolCall } from '../../plugins/types';
import type { RoleName } from '../roles';

/** Stop reasons are closed — the UI never needs a default branch. */
export type StopReason =
  | 'committed'      // commit_extracted_data ran
  | 'text_final'     // LLM answered without tool_calls
  | 'aborted'        // external AbortSignal fired
  | 'max_steps'      // step budget exhausted
  | 'loop_detected'  // same tool+args repeated > threshold
  | 'tool_error'     // unrecoverable tool failure
  | 'llm_error'      // provider threw / role unresolved
  | 'retry_limit';   // attempts exhausted (placeholder for fail-over)

export interface AgentMode {
  kind: 'chat' | 'browser' | 'skill' | 'extract';
  /** Browser session id used by Playwright tools. Required for `browser` and `extract`. */
  browserSessionId?: string;
  /** Skill playbook name (maps to ~/.redbus/skills/<name>/SKILL.md). */
  skillName?: string;
  /** Channel id for `extract` mode. */
  channelId?: 'outlook' | 'teams';
  /** Target URL for `extract` mode (opened before the first turn). */
  url?: string;
  /** Target date (YYYY-MM-DD) for `extract` mode. */
  targetDate?: string;
}

export interface AgentPrompt {
  /** System message body (role instructions, rules). */
  system?: string;
  /** User turn prepended to `history`. */
  user: string;
  /** Pre-existing conversation turns the runner should replay. */
  history?: PluginMessage[];
}

export interface AgentRunParams {
  runId: string;
  sessionId: string;
  role: RoleName;
  prompt: AgentPrompt;
  mode: AgentMode;
  /** Allow-list of tool names. When omitted, all tools registered in the plugin registry are exposed. */
  tools?: string[];
  /** Hard cap on ReAct turns. Default: 25. */
  maxSteps?: number;
  /** External abort signal — wired by the caller (e.g. an IPC handler). */
  abortSignal?: AbortSignal;
  /** Window for HITL dialogs and step progress events (temporary; Spec 07 moves this to a hook). */
  mainWindow?: BrowserWindow;
}

/** Recorded per-turn entry — enough for a timeline in the UI. */
export interface AttemptTraceTurn {
  stepIndex: number;
  toolName?: string;
  toolArgs?: unknown;
  toolDurationMs?: number;
  toolError?: string;
  /** Truncated tool output (first ~500 chars) for trace purposes. */
  toolOutputPreview?: string;
  /** Present on the final turn when the LLM emitted text instead of tool_calls. */
  textOutputPreview?: string;
}

export interface AttemptTrace {
  attemptIdx: number;
  startedAt: number;
  endedAt: number;
  stopReason: StopReason;
  turns: AttemptTraceTurn[];
  error?: { kind: string; message: string };
}

export interface ToolSummary {
  /** Total tool invocations (including failures). */
  calls: number;
  /** Unique tool names invoked, insertion-ordered. */
  tools: string[];
  failures: number;
  totalMs: number;
}

export interface AgentRunMeta {
  durationMs: number;
  aborted: boolean;
  stopReason: StopReason;
  /** Tool calls the LLM emitted but the runner could not dispatch (unknown tool / schema repair failed). */
  pendingToolCalls?: Array<{ id?: string; name: string; args: unknown }>;
  toolSummary: ToolSummary;
  executionTrace: AttemptTrace[];
  error?: { kind: string; message: string };
}

export interface AgentRunResult {
  /** Data committed via `commit_extracted_data`. Undefined when the run ended on text or error. */
  committedData?: unknown;
  /** Raw final text when `stopReason === 'text_final'`. */
  finalText?: string;
  meta: AgentRunMeta;
}

/** Internal Attempt outcome consumed by `runAgent`. */
export interface AttemptResult {
  stopReason: StopReason;
  committedData?: unknown;
  finalText?: string;
  pendingToolCalls?: Array<{ id?: string; name: string; args: unknown }>;
  trace: AttemptTrace;
  /** Aggregated counters for the outer run summary. */
  toolCounters: ToolSummary;
  error?: { kind: string; message: string };
}

/** Raised inside the runner when an external `AbortSignal` fires. */
export class RunAbortedError extends Error {
  readonly name = 'AbortError';
  constructor(message = 'Run aborted') {
    super(message);
  }
}

/** A tool call emitted by the LLM during an attempt. Alias of the provider-agnostic shape. */
export type AgentToolCall = PluginToolCall;

