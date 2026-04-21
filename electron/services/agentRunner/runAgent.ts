/**
 * Public runner. `runAgent(db, params)` is the one entry point that
 * replaces `executeWorkerOnView`, `executeSkillTask`, and `intelligentExtract`.
 *
 * Flow:
 *   1. Wire up an `AbortController` (chained to `params.abortSignal` if given).
 *   2. Enqueue in the per-session lane so two runs on the same chat serialize.
 *   3. Run at least one `runAttempt`; future Spec 01 fail-over may add retries.
 *   4. Assemble a typed `AgentRunResult` (duration, stopReason, toolSummary,
 *      executionTrace) — no more `any` return.
 */
import { v4 as uuidv4 } from 'uuid';
import { runAttempt } from './runAttempt';
import { enqueueInLane } from './runLanes';
import { registerRun, unregisterRun, type RunHandle } from './runRegistry';
import type { AgentRunParams, AgentRunResult, AgentRunMeta, AttemptResult } from './types';

const MAX_ATTEMPTS = 1;

export async function runAgent(db: any, params: AgentRunParams): Promise<AgentRunResult> {
  const controller = new AbortController();
  if (params.abortSignal) {
    if (params.abortSignal.aborted) controller.abort(params.abortSignal.reason);
    else params.abortSignal.addEventListener('abort', () => controller.abort(params.abortSignal?.reason), { once: true });
  }

  const handle: RunHandle = {
    runId: params.runId,
    sessionId: params.sessionId,
    startedAt: Date.now(),
    abortController: controller,
  };

  const laneKey = `session:${params.sessionId}`;
  const startedAt = Date.now();

  return enqueueInLane(laneKey, async () => {
    registerRun(handle);
    try {
      let lastAttempt: AttemptResult | null = null;
      for (let attemptIdx = 0; attemptIdx < MAX_ATTEMPTS; attemptIdx++) {
        if (controller.signal.aborted) break;
        lastAttempt = await runAttempt({ db, params, attemptIdx, signal: controller.signal });
        if (lastAttempt.stopReason === 'committed' || lastAttempt.stopReason === 'text_final') break;
        if (lastAttempt.stopReason === 'aborted' || lastAttempt.stopReason === 'loop_detected') break;
      }

      return assembleResult(startedAt, controller.signal.aborted, lastAttempt);
    } finally {
      unregisterRun(params.runId);
    }
  });
}

function assembleResult(
  startedAt: number,
  aborted: boolean,
  attempt: AttemptResult | null,
): AgentRunResult {
  if (!attempt) {
    const meta: AgentRunMeta = {
      durationMs: Date.now() - startedAt,
      aborted,
      stopReason: aborted ? 'aborted' : 'retry_limit',
      toolSummary: { calls: 0, tools: [], failures: 0, totalMs: 0 },
      executionTrace: [],
      error: { kind: aborted ? 'aborted' : 'retry_limit', message: 'No attempt completed' },
    };
    return { meta };
  }

  const meta: AgentRunMeta = {
    durationMs: Date.now() - startedAt,
    aborted: aborted || attempt.stopReason === 'aborted',
    stopReason: attempt.stopReason,
    pendingToolCalls: attempt.pendingToolCalls,
    toolSummary: attempt.toolCounters,
    executionTrace: [attempt.trace],
    error: attempt.error,
  };

  return {
    committedData: attempt.committedData,
    finalText: attempt.finalText,
    meta,
  };
}

/** Convenience to mint a fresh run id when the caller does not have one. */
export function newRunId(): string {
  return uuidv4();
}

