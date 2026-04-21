/**
 * Lightweight tool-call loop detection.
 *
 * Ported (trimmed subset) from `oc/src/agents/tool-loop-detection.ts` —
 * we only need the "same tool name + identical args N times in a row"
 * heuristic. The full `oc` module adds ping-pong, poll-no-progress, and
 * global circuit breakers; those can be ported later if the simpler
 * check does not cover real cases in practice.
 */
import { createHash } from 'node:crypto';
import type { AttemptTraceTurn, AgentToolCall } from './types';

/** 3 consecutive identical calls is enough to break the loop. */
export const LOOP_THRESHOLD = 3;

/**
 * Stable stringify that sorts object keys — required so `{a:1,b:2}` and
 * `{b:2,a:1}` hash the same.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function hashToolCall(toolName: string, params: unknown): string {
  return `${toolName}:${createHash('sha256').update(stableStringify(params)).digest('hex')}`;
}

/**
 * Returns `{ count }` when the current `toolCall` is the Nth consecutive
 * invocation with identical (name, args) hash — and N ≥ threshold.
 * Returns `null` otherwise.
 */
export function detectLoop(
  turns: AttemptTraceTurn[],
  toolCall: AgentToolCall,
  threshold = LOOP_THRESHOLD,
): { count: number; hash: string } | null {
  const currentHash = hashToolCall(toolCall.name, toolCall.args);
  let streak = 1;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn?.toolName) break;
    const prevHash = hashToolCall(turn.toolName, turn.toolArgs);
    if (prevHash !== currentHash) break;
    streak++;
    if (streak >= threshold) return { count: streak, hash: currentHash };
  }
  return null;
}

