/**
 * Public surface of the unified agent runner (Spec 09).
 *
 *   runAgent(db, params) → AgentRunResult
 *   abortRun(sessionId)  → boolean
 *   listActiveRuns()
 *   resolveHumanConsent(requestId, approved)  (HITL bridge; temporary)
 */
export { runAgent, newRunId } from './runAgent';
export { abortRun, abortAllRuns, getActiveRun, listActiveRuns, getRunById } from './runRegistry';
export { resolveHumanConsent } from './consent';
export { RunAbortedError } from './types';
export type {
  AgentRunParams,
  AgentRunResult,
  AgentRunMeta,
  AgentMode,
  AgentPrompt,
  AttemptTrace,
  AttemptTraceTurn,
  ToolSummary,
  StopReason,
  AgentToolCall,
} from './types';

