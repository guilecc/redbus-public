/**
 * Shared HTTP helper — AbortController-based timeout used by every provider
 * plugin. Kept separate from `llmService.fetchWithTimeout` so plugins do not
 * create a dependency cycle back to `llmService`.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 120_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs / 1000}s — the model may be overloaded or the prompt too large.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

