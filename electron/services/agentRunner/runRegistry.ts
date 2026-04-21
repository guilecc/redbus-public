/**
 * In-memory registry of currently executing agent runs.
 *
 * Subset of `oc/src/agents/pi-embedded-runner/runs.ts` — we expose the
 * minimum surface the UI needs today:
 *   - abort a run by sessionId (the IPC handler uses this)
 *   - list active runs (debug/inspection)
 *
 * `queueMessage` and `waitForEnd` can be added when the UI grows a
 * "type while thinking" feature; keeping the handle small for now.
 */

export interface RunHandle {
  runId: string;
  sessionId: string;
  startedAt: number;
  abortController: AbortController;
}

const byRunId = new Map<string, RunHandle>();
const bySessionId = new Map<string, RunHandle>();

export function registerRun(handle: RunHandle): void {
  byRunId.set(handle.runId, handle);
  bySessionId.set(handle.sessionId, handle);
}

export function unregisterRun(runId: string): void {
  const handle = byRunId.get(runId);
  if (!handle) return;
  byRunId.delete(runId);
  if (bySessionId.get(handle.sessionId)?.runId === runId) {
    bySessionId.delete(handle.sessionId);
  }
}

export function getActiveRun(sessionId: string): RunHandle | undefined {
  return bySessionId.get(sessionId);
}

export function getRunById(runId: string): RunHandle | undefined {
  return byRunId.get(runId);
}

export function listActiveRuns(): Array<{ runId: string; sessionId: string; startedAt: number }> {
  return Array.from(byRunId.values()).map((h) => ({
    runId: h.runId,
    sessionId: h.sessionId,
    startedAt: h.startedAt,
  }));
}

export type AbortReason = 'user' | 'superseded' | 'timeout';

/**
 * Abort the run currently executing on `sessionId`, if any. Returns `true`
 * when a run was found and signalled, `false` otherwise.
 */
export function abortRun(sessionId: string, reason: AbortReason = 'user'): boolean {
  const handle = bySessionId.get(sessionId);
  if (!handle) return false;
  if (!handle.abortController.signal.aborted) {
    handle.abortController.abort(reason);
  }
  return true;
}

/** Abort every active run — used on shutdown / factory-reset flows. */
export function abortAllRuns(reason: AbortReason = 'superseded'): number {
  let count = 0;
  for (const handle of byRunId.values()) {
    if (!handle.abortController.signal.aborted) {
      handle.abortController.abort(reason);
      count++;
    }
  }
  return count;
}

