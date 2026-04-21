import type { ChatOptions, ChatResult, ChatStreamCallbacks, ModelOption, PluginMessage, ProviderPlugin, ThinkingCapability } from '../types';
import { toolsToOpenAi } from '../tool-schema';
import { fetchWithTimeout } from '../http';
import { consumeOpenAiStream } from './streams/openai-stream';
import type { ThinkLevel, ThinkingStreamEvent } from '../../services/thinking';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

function toOpenAiMessages(systemPrompt: string, messages: PluginMessage[]): any[] {
  const mapped = messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content || '', tool_call_id: m.tool_call_id, name: m.name };
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args) },
        })),
      };
    }
    return { role: m.role, content: m.content || '' };
  });
  return [{ role: 'system', content: systemPrompt }, ...mapped];
}

async function listModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenAI API Error: ${await response.text()}`);
  const data = await response.json();
  const list = data.data || [];
  return list
    .filter((m: any) => m.id.includes('gpt') || m.id.includes('o1') || m.id.includes('o3'))
    .map((m: any) => ({ id: m.id, name: m.id }))
    .sort((a: ModelOption, b: ModelOption) => b.id.localeCompare(a.id));
}

function buildOpenAiBody(opts: ChatOptions): any {
  const { model, systemPrompt, messages, tools, responseFormat, maxTokens, temperature } = opts;
  const body: any = {
    model,
    messages: toOpenAiMessages(systemPrompt, messages),
  };
  if (tools && tools.length > 0) body.tools = toolsToOpenAi(tools);
  if (responseFormat === 'json_object') body.response_format = { type: 'json_object' };
  if (maxTokens) body.max_tokens = maxTokens;
  if (typeof temperature === 'number') body.temperature = temperature;
  return body;
}

async function chat(opts: ChatOptions): Promise<ChatResult> {
  const { configs } = opts;
  if (!configs.openAiKey) throw new Error('OpenAI API Key is missing');

  const body = buildOpenAiBody(opts);

  const response = await fetchWithTimeout(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${configs.openAiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`OpenAI API Error: ${await response.text()}`);
  const data = await response.json();
  if (!data.choices || data.choices.length === 0) throw new Error('GPT no choices');

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

/** Reasoning models (o-series, gpt-5*) accept `reasoning_effort`. Plain GPT
 *  models silently ignore it, so we still send it for forward-compat. */
function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase();
  return /^(o1|o3|o4|gpt-5)/.test(m) || m.includes('-reasoning');
}

function levelToOpenAiEffort(level: ThinkLevel): string | undefined {
  switch (level) {
    case 'off': return undefined;
    case 'minimal': return 'minimal';
    case 'low': return 'low';
    case 'medium': return 'medium';
    case 'high':
    case 'xhigh': return 'high';
    case 'adaptive': return 'medium';
  }
}

function createOpenAiThinkingCapability(): ThinkingCapability {
  return {
    supported: ['off', 'minimal', 'low', 'medium', 'high', 'adaptive'],
    default: 'medium',
    toRequestOptions(level: ThinkLevel, model: string) {
      if (level === 'off' || !isReasoningModel(model)) return {};
      const effort = levelToOpenAiEffort(level);
      return effort ? { reasoning_effort: effort } : {};
    },
    parseStreamChunk(chunk: unknown): ThinkingStreamEvent[] {
      const events: ThinkingStreamEvent[] = [];
      if (!chunk || typeof chunk !== 'object') return events;
      const c = chunk as any;
      const delta = c.choices?.[0]?.delta;
      if (!delta) {
        if (c.choices?.[0]?.finish_reason) events.push({ type: 'response-end' });
        return events;
      }
      // o-series streams reasoning under `reasoning_content`; gpt-5 uses `reasoning`.
      const reasoning = delta.reasoning_content || delta.reasoning;
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        events.push({ type: 'thinking-chunk', text: reasoning });
      }
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        events.push({ type: 'response-chunk', text: delta.content });
      }
      if (c.choices?.[0]?.finish_reason) events.push({ type: 'response-end' });
      return events;
    },
  };
}

const openAiThinkingCapability = createOpenAiThinkingCapability();

async function chatStream(opts: ChatOptions, cb: ChatStreamCallbacks): Promise<string> {
  const { configs, model, thinkingLevel } = opts;
  if (!configs.openAiKey) throw new Error('OpenAI API Key is missing');

  const body: any = { ...buildOpenAiBody(opts), stream: true };
  if (thinkingLevel && openAiThinkingCapability.supported.includes(thinkingLevel)) {
    Object.assign(body, openAiThinkingCapability.toRequestOptions(thinkingLevel, model));
  }

  const response = await fetchWithTimeout(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${configs.openAiKey}`,
    },
    body: JSON.stringify(body),
  }, 300_000);

  return await consumeOpenAiStream(response, openAiThinkingCapability, cb);
}

/**
 * Spec 08 recommendations. Reasoning-series (o3/o1) is the planner pick
 * when reachable; otherwise fall back to gpt-4/5. Mini/nano variants make
 * cheap synthesizers.
 */
function pickOpenAi(models: string[], re: RegExp): string | null {
  const m = models.filter((id) => re.test(id));
  if (m.length === 0) return null;
  return m.sort().reverse()[0];
}

function recommendOpenAi(role: 'planner' | 'executor' | 'synthesizer' | 'utility' | 'digest', models: string[]) {
  if (role === 'planner') {
    const o3 = pickOpenAi(models, /^o3/i);
    if (o3) return { model: o3, thinkingLevel: 'high' as const, notes: 'Reasoning-series model tuned for planning.' };
    const o1 = pickOpenAi(models, /^o1/i);
    if (o1) return { model: o1, thinkingLevel: 'high' as const, notes: 'Reasoning-series model tuned for planning.' };
    const gpt5 = pickOpenAi(models, /^gpt-5/i);
    if (gpt5) return { model: gpt5, thinkingLevel: 'medium' as const };
    const gpt4 = pickOpenAi(models, /^gpt-4/i);
    if (gpt4) return { model: gpt4, thinkingLevel: 'medium' as const };
    return null;
  }
  if (role === 'synthesizer' || role === 'utility') {
    const nano = pickOpenAi(models, /nano/i);
    if (nano) return { model: nano, thinkingLevel: 'off' as const, notes: 'Ultra-cheap for synthesis and utility.' };
    const mini = pickOpenAi(models, /mini/i);
    if (mini) return { model: mini, thinkingLevel: 'off' as const, notes: 'Cheap and fast for synthesis.' };
    const gpt4 = pickOpenAi(models, /^gpt-4/i);
    if (gpt4) return { model: gpt4, thinkingLevel: 'off' as const };
    return null;
  }
  if (role === 'digest') {
    const nano = pickOpenAi(models, /nano/i);
    if (nano) return { model: nano, thinkingLevel: 'off' as const, notes: 'Ultra-cheap for bulk digest. A local Ollama model is preferred when available.' };
    const mini = pickOpenAi(models, /mini/i);
    if (mini) return { model: mini, thinkingLevel: 'off' as const, notes: 'Cheap pick for bulk digest. Local Ollama preferred when available.' };
    return null;
  }
  return null;
}

export function createOpenAiProvider(): ProviderPlugin {
  return {
    id: 'openai',
    label: 'OpenAI GPT',
    // Match any OpenAI-hosted model family currently used in redbus.
    matches: (model) => model.includes('gpt') || model.includes('o1') || model.includes('o3'),
    listModels,
    chat,
    chatStream,
    capabilities: { thinking: openAiThinkingCapability },
    recommendedFor: {
      planner: (models) => recommendOpenAi('planner', models),
      synthesizer: (models) => recommendOpenAi('synthesizer', models),
      utility: (models) => recommendOpenAi('utility', models),
      digest: (models) => recommendOpenAi('digest', models),
    },
  };
}

