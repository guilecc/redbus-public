import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRun,
  unregisterRun,
  abortRun,
  abortAllRuns,
  getActiveRun,
  getRunById,
  listActiveRuns,
  type RunHandle,
} from '../electron/services/agentRunner/runRegistry';

function makeHandle(runId: string, sessionId: string): RunHandle {
  return {
    runId,
    sessionId,
    startedAt: Date.now(),
    abortController: new AbortController(),
  };
}

describe('runRegistry', () => {
  // clean slate between tests — registry is module-level state
  beforeEach(() => {
    for (const h of listActiveRuns()) unregisterRun(h.runId);
  });

  it('registerRun + getActiveRun/getRunById round-trip', () => {
    const h = makeHandle('run-1', 'sess-A');
    registerRun(h);
    expect(getActiveRun('sess-A')).toBe(h);
    expect(getRunById('run-1')).toBe(h);
  });

  it('listActiveRuns returns a serializable summary for every registered run', () => {
    registerRun(makeHandle('r1', 's1'));
    registerRun(makeHandle('r2', 's2'));
    const list = listActiveRuns();
    expect(list.map((e) => e.runId).sort()).toEqual(['r1', 'r2']);
    for (const entry of list) {
      expect(typeof entry.sessionId).toBe('string');
      expect(typeof entry.startedAt).toBe('number');
      // must not leak the AbortController to callers
      expect((entry as any).abortController).toBeUndefined();
    }
  });

  it('unregisterRun drops both indexes', () => {
    const h = makeHandle('run-2', 'sess-B');
    registerRun(h);
    unregisterRun('run-2');
    expect(getActiveRun('sess-B')).toBeUndefined();
    expect(getRunById('run-2')).toBeUndefined();
  });

  it('abortRun signals the AbortController and returns true', () => {
    const h = makeHandle('run-3', 'sess-C');
    registerRun(h);
    expect(abortRun('sess-C', 'user')).toBe(true);
    expect(h.abortController.signal.aborted).toBe(true);
    expect(h.abortController.signal.reason).toBe('user');
  });

  it('abortRun returns false when no run is registered for that session', () => {
    expect(abortRun('never-seen')).toBe(false);
  });

  it('abortRun is idempotent — second call does not throw or re-abort', () => {
    const h = makeHandle('run-4', 'sess-D');
    registerRun(h);
    abortRun('sess-D', 'user');
    // second call still returns true (run is still registered) but does not re-abort
    const secondCall = abortRun('sess-D', 'timeout');
    expect(secondCall).toBe(true);
    expect(h.abortController.signal.reason).toBe('user');
  });

  it('abortAllRuns aborts every active run and returns the count', () => {
    const h1 = makeHandle('r1', 's1');
    const h2 = makeHandle('r2', 's2');
    registerRun(h1);
    registerRun(h2);
    const count = abortAllRuns('superseded');
    expect(count).toBe(2);
    expect(h1.abortController.signal.aborted).toBe(true);
    expect(h2.abortController.signal.aborted).toBe(true);
  });

  it('abortAllRuns skips already-aborted runs', () => {
    const h1 = makeHandle('r1', 's1');
    const h2 = makeHandle('r2', 's2');
    registerRun(h1);
    registerRun(h2);
    h1.abortController.abort('external');
    const count = abortAllRuns('superseded');
    expect(count).toBe(1);
  });

  it('reusing a sessionId moves the index to the latest registered run', () => {
    const old = makeHandle('r-old', 'same-sess');
    const fresh = makeHandle('r-new', 'same-sess');
    registerRun(old);
    registerRun(fresh);
    // sessionId index now points at the newer run
    expect(getActiveRun('same-sess')).toBe(fresh);
    // abort via sessionId targets the fresh run, not the old one
    abortRun('same-sess');
    expect(fresh.abortController.signal.aborted).toBe(true);
    expect(old.abortController.signal.aborted).toBe(false);
  });
});

