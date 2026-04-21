/**
 * Abort helpers. Called before every `await` inside the runner so an
 * external `AbortSignal` can short-circuit a long tool call or LLM fetch.
 */
import { RunAbortedError } from './types';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RunAbortedError(typeof signal.reason === 'string' ? signal.reason : 'Run aborted');
}

