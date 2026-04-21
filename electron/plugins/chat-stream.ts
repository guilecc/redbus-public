/**
 * Bridge between the plugin `chatStream` contract and the legacy streamBus
 * event channel used throughout the app. Callers supply the request id; all
 * thinking + response chunks are forwarded to streamBus while the accumulated
 * text is returned for downstream JSON parsing.
 */
import type { ChatOptions, ChatStreamCallbacks } from './types';
import { getProviderForModel } from './registry';
import {
  emitThinkingStart,
  emitThinkingChunk,
  emitThinkingEnd,
  emitResponseChunk,
} from '../services/streamBus';

export interface ChatWithStreamOptions extends Omit<ChatOptions, 'requestId'> {
  /** Forward response-chunk events to streamBus when set. */
  emitResponseChunks?: boolean;
  /** Additional callbacks layered on top of the streamBus bridge. */
  callbacks?: ChatStreamCallbacks;
}

/**
 * Invoke the plugin's chatStream, bridging events to streamBus when a
 * requestId is provided. Returns the accumulated text.
 */
export async function chatWithStream(
  opts: ChatWithStreamOptions,
  requestId?: string | null,
): Promise<string> {
  const provider = getProviderForModel(opts.model);
  if (!provider.chatStream) {
    throw new Error(`Provider ${provider.id} does not implement chatStream`);
  }

  let accumulated = '';

  const bridge: ChatStreamCallbacks = {
    onThinkingStart: () => {
      if (requestId) emitThinkingStart(requestId);
      opts.callbacks?.onThinkingStart?.();
    },
    onThinkingChunk: (text) => {
      if (requestId) emitThinkingChunk(requestId, text);
      opts.callbacks?.onThinkingChunk?.(text);
    },
    onThinkingEnd: () => {
      if (requestId) emitThinkingEnd(requestId);
      opts.callbacks?.onThinkingEnd?.();
    },
    onTextChunk: (text) => {
      accumulated += text;
      if (requestId && opts.emitResponseChunks) {
        emitResponseChunk(requestId, text, accumulated);
      }
      opts.callbacks?.onTextChunk?.(text);
    },
  };

  const { emitResponseChunks, callbacks, ...chatOpts } = opts;
  void emitResponseChunks; void callbacks;

  const full = await provider.chatStream({ ...chatOpts, requestId: requestId || null }, bridge);
  return full;
}

