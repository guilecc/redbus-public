import { describe, it, expect } from 'vitest';
import {
  detectLoop,
  hashToolCall,
  LOOP_THRESHOLD,
} from '../electron/services/agentRunner/loopDetection';
import type { AttemptTraceTurn, AgentToolCall } from '../electron/services/agentRunner/types';

function turn(name: string, args: unknown, stepIndex = 1): AttemptTraceTurn {
  return { stepIndex, toolName: name, toolArgs: args };
}

describe('loopDetection.hashToolCall', () => {
  it('is stable across key order in arguments', () => {
    const a = hashToolCall('browser_click', { ref: 'e1', other: 'x' });
    const b = hashToolCall('browser_click', { other: 'x', ref: 'e1' });
    expect(a).toBe(b);
  });

  it('differs when tool name changes', () => {
    expect(hashToolCall('browser_click', { ref: 'e1' })).not.toBe(
      hashToolCall('browser_type', { ref: 'e1' }),
    );
  });

  it('differs when arguments change', () => {
    expect(hashToolCall('browser_click', { ref: 'e1' })).not.toBe(
      hashToolCall('browser_click', { ref: 'e2' }),
    );
  });

  it('handles nested objects and arrays deterministically', () => {
    const a = hashToolCall('t', { a: [1, 2, { k: 'v', j: 'w' }] });
    const b = hashToolCall('t', { a: [1, 2, { j: 'w', k: 'v' }] });
    expect(a).toBe(b);
  });
});

describe('loopDetection.detectLoop', () => {
  const toolCall: AgentToolCall = { name: 'browser_click', args: { ref: 'e1' } };

  it('returns null when there is no matching streak', () => {
    const turns = [turn('browser_snapshot', {})];
    expect(detectLoop(turns, toolCall)).toBeNull();
  });

  it('returns null below the threshold (2 consecutive)', () => {
    const turns = [turn('browser_click', { ref: 'e1' })];
    expect(detectLoop(turns, toolCall)).toBeNull();
  });

  it('triggers at the threshold (3 consecutive identical calls)', () => {
    const turns = [
      turn('browser_click', { ref: 'e1' }),
      turn('browser_click', { ref: 'e1' }),
    ];
    const hit = detectLoop(turns, toolCall);
    expect(hit).not.toBeNull();
    expect(hit?.count).toBe(LOOP_THRESHOLD);
  });

  it('resets the streak when arguments change mid-stream', () => {
    const turns = [
      turn('browser_click', { ref: 'e1' }),
      turn('browser_click', { ref: 'e2' }),
    ];
    expect(detectLoop(turns, toolCall)).toBeNull();
  });

  it('resets the streak when tool name changes mid-stream', () => {
    const turns = [
      turn('browser_click', { ref: 'e1' }),
      turn('browser_snapshot', {}),
    ];
    expect(detectLoop(turns, toolCall)).toBeNull();
  });

  it('respects a custom threshold', () => {
    const turns = [turn('browser_click', { ref: 'e1' })];
    const hit = detectLoop(turns, toolCall, 2);
    expect(hit?.count).toBe(2);
  });

  it('ignores trace turns without a toolName (text-only turns)', () => {
    const turns: AttemptTraceTurn[] = [
      turn('browser_click', { ref: 'e1' }),
      turn('browser_click', { ref: 'e1' }),
      { stepIndex: 3, textOutputPreview: 'intermediate thought' },
    ];
    expect(detectLoop(turns, toolCall)).toBeNull();
  });
});

