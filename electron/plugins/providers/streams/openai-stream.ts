/**
 * OpenAI SSE stream consumer. Uses the provider's ThinkingCapability to
 * emit canonical events (reasoning / content) and invokes callbacks.
 */
import type { ChatStreamCallbacks, ThinkingCapability } from '../../types';

export async function consumeOpenAiStream(
  response: Response,
  capability: ThinkingCapability | undefined,
  cb: ChatStreamCallbacks,
): Promise<string> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI stream request failed: ${response.status} ${response.statusText} ${text}`);
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

      if (capability) {
        for (const ev of capability.parseStreamChunk(parsed)) {
          if (ev.type === 'thinking-chunk') cb.onThinkingChunk?.(ev.text);
          else if (ev.type === 'response-chunk') {
            fullText += ev.text;
            cb.onTextChunk?.(ev.text);
          }
        }
      } else {
        const text = parsed.choices?.[0]?.delta?.content || '';
        if (text) {
          fullText += text;
          cb.onTextChunk?.(text);
        }
      }
    }
  }
  return fullText;
}

