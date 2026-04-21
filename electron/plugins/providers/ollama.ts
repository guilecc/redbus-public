/**
 * Ollama (local) and Ollama Cloud providers share a single chat implementation
 * that falls back from the OpenAI-compat `/v1/chat/completions` endpoint to
 * the native `/api/chat` endpoint when the former returns 404/405.
 */
import type { ChatOptions, ChatResult, ChatStreamCallbacks, ModelOption, PluginMessage, ProviderPlugin, ThinkingCapability } from '../types';
import { toolsToOpenAi } from '../tool-schema';
import { fetchWithTimeout } from '../http';
import { consumeOllamaStream } from './streams/ollama-stream';
import type { ThinkLevel, ThinkingStreamEvent } from '../../services/thinking';

export interface CallOllamaOptions {
  headers?: Record<string, string>;
  response_format?: { type: string };
  tools?: any[];
  timeoutMs?: number;
  numPredict?: number;
}

export async function callOllamaChat(
  baseUrl: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  options: CallOllamaOptions = {}
): Promise<{ choices: Array<{ message: { role: string; content: string; tool_calls?: any[] } }> }> {
  const url = baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs || 300_000;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers || {}) };

  const body: any = { model, messages };
  if (options.response_format) body.response_format = options.response_format;
  if (options.tools) body.tools = options.tools;
  if (options.numPredict) body.max_tokens = options.numPredict;

  const openaiRes = await fetchWithTimeout(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, timeoutMs);

  if (openaiRes.ok) return openaiRes.json();

  if (openaiRes.status !== 404 && openaiRes.status !== 405) {
    throw new Error(`Ollama API Error (${openaiRes.status}): ${await openaiRes.text()}`);
  }

  console.log(`[Ollama] /v1/chat/completions returned ${openaiRes.status}, falling back to /api/chat`);
  const nativeBody: any = { model, messages, stream: false };
  if (options.response_format) nativeBody.format = 'json';
  if (options.tools) nativeBody.tools = options.tools;
  if (options.numPredict) nativeBody.options = { num_predict: options.numPredict };

  const nativeRes = await fetchWithTimeout(`${url}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(nativeBody),
  }, timeoutMs);

  if (!nativeRes.ok) {
    throw new Error(`Ollama native API Error (${nativeRes.status}): ${await nativeRes.text()}`);
  }

  const nativeData = await nativeRes.json();
  return {
    choices: [{
      message: {
        role: nativeData.message?.role || 'assistant',
        content: nativeData.message?.content || '',
        tool_calls: nativeData.message?.tool_calls,
      },
    }],
  };
}

function toOllamaMessages(systemPrompt: string, messages: PluginMessage[]): Array<{ role: string; content: string;[k: string]: any }> {
  const mapped = messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content || '', tool_call_id: m.tool_call_id, name: m.name };
    }
    return { role: m.role, content: m.content || '' };
  });
  return [{ role: 'system', content: systemPrompt }, ...mapped];
}

interface OllamaContext { isCloud: boolean; }

async function listModelsFactory(_ctx: OllamaContext, apiKey: string, customUrl?: string): Promise<ModelOption[]> {
  const baseUrl = customUrl ? `${customUrl}/v1/models` : 'https://ollama.com/v1/models';
  const response = await fetch(baseUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`Ollama Cloud API Error: ${await response.text()}`);
  const data = await response.json();
  const list = data.data || [];
  return list.map((m: any) => ({ id: m.id, name: m.id }))
    .sort((a: ModelOption, b: ModelOption) => b.id.localeCompare(a.id));
}

async function chatFactory(ctx: OllamaContext, opts: ChatOptions): Promise<ChatResult> {
  const { model, configs, systemPrompt, messages, tools, responseFormat } = opts;
  if (ctx.isCloud && !configs.ollamaCloudKey) throw new Error('Ollama Cloud API Key is missing');
  const targetUrl = ctx.isCloud
    ? (configs.ollamaCloudUrl || 'https://ollama.com')
    : (configs.ollamaUrl || 'http://localhost:11434');
  const cleanModel = model.replace('ollama/', '').replace('ollama-cloud/', '');
  const authHeaders = ctx.isCloud && configs.ollamaCloudKey
    ? { Authorization: `Bearer ${configs.ollamaCloudKey}` }
    : undefined;

  const callOpts: CallOllamaOptions = { headers: authHeaders };
  if (responseFormat === 'json_object') callOpts.response_format = { type: 'json_object' };
  if (tools && tools.length > 0) callOpts.tools = toolsToOpenAi(tools);

  const data = await callOllamaChat(
    targetUrl,
    cleanModel,
    toOllamaMessages(systemPrompt, messages),
    callOpts
  );

  const message = data.choices[0].message;
  if (message.tool_calls) {
    return {
      tool_calls: message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
      })),
    };
  }
  return { content: message.content };
}

/** Heuristic: model id likely supports a `think` option (gpt-oss, qwen3-thinking,
 *  deepseek-r1, lfm-thinking, etc.). When unknown, we fall back to off-only. */
function modelLikelySupportsThinking(model: string): boolean {
  const m = model.toLowerCase();
  return /thinking|reason|gpt-oss|qwen3|deepseek-r1|lfm.*think|r1/.test(m);
}

function levelToOllamaThink(level: ThinkLevel): boolean | string | undefined {
  switch (level) {
    case 'off': return undefined;
    case 'minimal':
    case 'low': return 'low';
    case 'medium': return 'medium';
    case 'high':
    case 'xhigh': return 'high';
    case 'adaptive': return true;
  }
}

export function createOllamaThinkingCapability(): ThinkingCapability {
  return {
    supported: ['off', 'low', 'medium', 'high', 'adaptive'],
    default: 'off',
    toRequestOptions(level: ThinkLevel, model: string) {
      if (level === 'off' || !modelLikelySupportsThinking(model)) return {};
      const think = levelToOllamaThink(level);
      return think === undefined ? {} : { think };
    },
    parseStreamChunk(chunk: unknown): ThinkingStreamEvent[] {
      const events: ThinkingStreamEvent[] = [];
      if (!chunk || typeof chunk !== 'object') return events;
      const c = chunk as any;
      // Ollama 0.5.8+ native chat: { message: { thinking, content }, done }
      // OpenAI-compat: { choices:[{delta:{ reasoning_content, content }}] }
      const thinking = c.message?.thinking || c.choices?.[0]?.delta?.reasoning_content;
      if (typeof thinking === 'string' && thinking.length > 0) {
        events.push({ type: 'thinking-chunk', text: thinking });
      }
      const content = c.choices?.[0]?.delta?.content || c.message?.content;
      if (typeof content === 'string' && content.length > 0) {
        events.push({ type: 'response-chunk', text: content });
      }
      if (c.done === true || c.choices?.[0]?.finish_reason) {
        events.push({ type: 'response-end' });
      }
      return events;
    },
  };
}

const ollamaThinkingCapability = createOllamaThinkingCapability();

async function chatStreamFactory(ctx: OllamaContext, opts: ChatOptions, cb: ChatStreamCallbacks): Promise<string> {
  const { model, configs, systemPrompt, messages, responseFormat, maxTokens, temperature, thinkingLevel } = opts;
  if (ctx.isCloud && !configs.ollamaCloudKey) throw new Error('Ollama Cloud API Key is missing');
  const rawTargetUrl = ctx.isCloud
    ? (configs.ollamaCloudUrl || 'https://ollama.com')
    : (configs.ollamaUrl || 'http://localhost:11434');
  const targetUrl = rawTargetUrl.replace(/\/+$/, '');
  const cleanModel = model.replace('ollama/', '').replace('ollama-cloud/', '');
  const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ctx.isCloud && configs.ollamaCloudKey) authHeaders.Authorization = `Bearer ${configs.ollamaCloudKey}`;

  const thinkOpts = thinkingLevel
    ? ollamaThinkingCapability.toRequestOptions(thinkingLevel, model)
    : {};

  const body: any = {
    model: cleanModel,
    messages: toOllamaMessages(systemPrompt, messages),
    stream: true,
    ...thinkOpts,
  };
  if (responseFormat === 'json_object') body.response_format = { type: 'json_object' };
  if (maxTokens) body.max_tokens = maxTokens;
  if (typeof temperature === 'number') body.temperature = temperature;

  let res = await fetchWithTimeout(`${targetUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(body),
  }, 300_000);

  if (!res.ok && (res.status === 404 || res.status === 405)) {
    const nativeBody: any = {
      model: cleanModel,
      messages: toOllamaMessages(systemPrompt, messages),
      stream: true,
      ...thinkOpts,
    };
    if (responseFormat === 'json_object') nativeBody.format = 'json';
    if (maxTokens) nativeBody.options = { ...(nativeBody.options || {}), num_predict: maxTokens };
    if (typeof temperature === 'number') nativeBody.options = { ...(nativeBody.options || {}), temperature };

    res = await fetchWithTimeout(`${targetUrl}/api/chat`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(nativeBody),
    }, 300_000);
  }

  return await consumeOllamaStream(res, ollamaThinkingCapability, cb);
}

/**
 * Spec 08 recommendations. For local/cloud Ollama we pick the first model
 * the user has actually pulled — onboarding surfaces it as the utility pick
 * (cheap local inference) and, when nothing else is available, as executor.
 */
function recommendOllama(role: 'planner' | 'executor' | 'synthesizer' | 'utility' | 'digest', models: string[], prefix: string) {
  if (models.length === 0) return null;
  const first = models[0];
  const modelId = first.startsWith(prefix) ? first : `${prefix}${first}`;
  if (role === 'utility') return { model: modelId, thinkingLevel: 'off' as const, notes: 'Local model — private, zero API cost.' };
  if (role === 'executor') return { model: modelId, thinkingLevel: 'off' as const, notes: 'Local executor — private, zero API cost.' };
  if (role === 'digest') return { model: modelId, thinkingLevel: 'off' as const, notes: 'Local digest — recommended for bulk summarization (zero cost, handles high message volume).' };
  return null;
}

export function createOllamaProvider(): ProviderPlugin {
  const ctx: OllamaContext = { isCloud: false };
  return {
    id: 'ollama',
    label: 'Ollama (local)',
    matches: (model) => model.startsWith('ollama/'),
    listModels: () => Promise.resolve([]),
    chat: (opts) => chatFactory(ctx, opts),
    chatStream: (opts, cb) => chatStreamFactory(ctx, opts, cb),
    capabilities: { thinking: ollamaThinkingCapability },
    recommendedFor: {
      utility: (models) => recommendOllama('utility', models, 'ollama/'),
      executor: (models) => recommendOllama('executor', models, 'ollama/'),
      digest: (models) => recommendOllama('digest', models, 'ollama/'),
    },
  };
}

export function createOllamaCloudProvider(): ProviderPlugin {
  const ctx: OllamaContext = { isCloud: true };
  return {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    matches: (model) => model.startsWith('ollama-cloud/'),
    listModels: (apiKey, customUrl) => listModelsFactory(ctx, apiKey, customUrl),
    chat: (opts) => chatFactory(ctx, opts),
    chatStream: (opts, cb) => chatStreamFactory(ctx, opts, cb),
    capabilities: { thinking: ollamaThinkingCapability },
    recommendedFor: {
      utility: (models) => recommendOllama('utility', models, 'ollama-cloud/'),
      executor: (models) => recommendOllama('executor', models, 'ollama-cloud/'),
      digest: (models) => recommendOllama('digest', models, 'ollama-cloud/'),
    },
  };
}

