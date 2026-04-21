/**
 * Per-key serial queues. Two runs targeting the same `sessionId` are
 * guaranteed to execute one after the other — no colliding Playwright
 * actions, no interleaved message saves.
 *
 * Mirrors `oc/src/agents/pi-embedded-runner/run/lanes.ts` in spirit.
 * Plain Promise chaining is enough; we do not need `p-queue` here because
 * the goal is serialize, not parallelize.
 */

const lanes = new Map<string, Promise<unknown>>();

export function enqueueInLane<T>(laneKey: string, task: () => Promise<T>): Promise<T> {
  const prev = lanes.get(laneKey) ?? Promise.resolve();
  // swallow prior errors so one failing run does not poison the chain
  const next = prev.catch(() => undefined).then(() => task());
  lanes.set(laneKey, next);
  // cleanup when this entry is the tail of the chain; the detached
  // promise below swallows rejections so it does not surface as an
  // "unhandled rejection" when the caller handles the error on `next`.
  next.finally(() => {
    if (lanes.get(laneKey) === next) lanes.delete(laneKey);
  }).catch(() => undefined);
  return next;
}

export function lanePending(laneKey: string): boolean {
  return lanes.has(laneKey);
}

