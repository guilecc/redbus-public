/**
 * Anthropic SSE stream consumer. Uses the provider's ThinkingCapability to
 * translate raw events to canonical ones and invokes the provided callbacks.
 * Returns the accumulated response text.
 */
import type { ChatStreamCallbacks, ThinkingCapability } from '../../types';

export async function consumeAnthropicStream(
  response: Response,
  capability: ThinkingCapability,
  cb: ChatStreamCallbacks,
): Promise<string> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic stream request failed: ${response.status} ${response.statusText} ${text}`);
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let fullText = '';
  let lineBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuffer += decoder.decode(value, { stream: true });

    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') continue;

      let parsed: any;
      try { parsed = JSON.parse(payload); } catch { continue; }

      for (const ev of capability.parseStreamChunk(parsed)) {
        switch (ev.type) {
          case 'thinking-start':
            cb.onThinkingStart?.();
            break;
          case 'thinking-chunk':
            cb.onThinkingChunk?.(ev.text);
            break;
          case 'thinking-end':
            cb.onThinkingEnd?.();
            break;
          case 'response-chunk':
            fullText += ev.text;
            cb.onTextChunk?.(ev.text);
            break;
          case 'response-end':
            break;
        }
      }
    }
  }
  return fullText;
}

