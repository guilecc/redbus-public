import { describe, it, expect } from 'vitest';
import { enqueueInLane, lanePending } from '../electron/services/agentRunner/runLanes';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('runLanes.enqueueInLane', () => {
  it('runs tasks on the same lane serially (no overlap)', async () => {
    const events: string[] = [];
    const task = (tag: string) => async () => {
      events.push(`start:${tag}`);
      await wait(20);
      events.push(`end:${tag}`);
      return tag;
    };

    const p1 = enqueueInLane('session-A', task('a'));
    const p2 = enqueueInLane('session-A', task('b'));
    const p3 = enqueueInLane('session-A', task('c'));

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(events).toEqual([
      'start:a', 'end:a',
      'start:b', 'end:b',
      'start:c', 'end:c',
    ]);
  });

  it('runs tasks on different lanes concurrently', async () => {
    const events: string[] = [];
    const task = (tag: string) => async () => {
      events.push(`start:${tag}`);
      await wait(30);
      events.push(`end:${tag}`);
      return tag;
    };

    const started = Date.now();
    await Promise.all([
      enqueueInLane('lane-1', task('x')),
      enqueueInLane('lane-2', task('y')),
    ]);
    const elapsed = Date.now() - started;

    // if they were serialized this would take ~60ms; parallel runs finish closer to 30ms
    expect(elapsed).toBeLessThan(60);
    // both tasks started before either finished
    expect(events.slice(0, 2).sort()).toEqual(['start:x', 'start:y']);
  });

  it('does not let a failing task poison subsequent tasks in the same lane', async () => {
    const failing = enqueueInLane('lane-F', async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');

    const ok = await enqueueInLane('lane-F', async () => 42);
    expect(ok).toBe(42);
  });

  it('lanePending reports true while a task is running and false after drain', async () => {
    const release = (() => {
      let fn: () => void = () => undefined;
      const p = new Promise<void>((resolve) => { fn = resolve; });
      return { promise: p, resolve: fn };
    })();

    const running = enqueueInLane('lane-P', async () => {
      await release.promise;
    });
    expect(lanePending('lane-P')).toBe(true);
    release.resolve();
    await running;
    // cleanup runs in a microtask; await one tick
    await Promise.resolve();
    expect(lanePending('lane-P')).toBe(false);
  });
});

