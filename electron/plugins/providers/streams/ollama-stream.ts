/**
 * Ollama streaming consumer. Accepts both `/v1/chat/completions` (OpenAI-compat
 * SSE) and `/api/chat` (NDJSON) shapes. Emits canonical events via the
 * provider's ThinkingCapability and falls back to inline `<think>` tag /
 * `"thinking": "..."` JSON-string detection for older models.
 */
import type { ChatStreamCallbacks, ThinkingCapability } from '../../types';

export async function consumeOllamaStream(
  response: Response,
  capability: ThinkingCapability,
  cb: ChatStreamCallbacks,
): Promise<string> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama stream request failed: ${response.status} ${response.statusText} ${text}`);
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let full = '';
  let lineBuffer = '';
  let inThinkTag = false;
  let inJsonThinkingStr = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuffer += decoder.decode(value, { stream: true });

    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      let parsed: any;
      try {
        if (line.startsWith('data: ')) {
          if (line === 'data: [DONE]') continue;
          parsed = JSON.parse(line.slice(6));
        } else {
          parsed = JSON.parse(line);
        }
      } catch { continue; }

      for (const ev of capability.parseStreamChunk(parsed)) {
        if (ev.type === 'thinking-chunk') cb.onThinkingChunk?.(ev.text);
      }

      const content = parsed.choices?.[0]?.delta?.content || parsed.message?.content || '';
      if (!content) continue;

      full += content;

      // Legacy inline-think detection: accumulated text kept complete so callers
      // can still parse the raw JSON payload; thinking chunks emitted separately.
      let treatedAsThinking = false;
      if (!inJsonThinkingStr) {
        if (content.includes('<think>')) inThinkTag = true;
        if (inThinkTag) {
          cb.onThinkingChunk?.(content.replace('<think>', '').replace('</think>', ''));
          if (content.includes('</think>')) inThinkTag = false;
          treatedAsThinking = true;
        }
      }

      if (!inThinkTag && !treatedAsThinking) {
        const thinkPrefixMatch = full.match(/"thinking"\s*:\s*"/);
        if (thinkPrefixMatch && !full.substring(thinkPrefixMatch.index! + thinkPrefixMatch[0].length).match(/",\s*"/)) {
          inJsonThinkingStr = true;
          cb.onThinkingChunk?.(content);
          treatedAsThinking = true;
        } else if (inJsonThinkingStr) {
          inJsonThinkingStr = false;
        }
      }

      if (!treatedAsThinking) cb.onTextChunk?.(content);
    }
  }
  return full;
}

