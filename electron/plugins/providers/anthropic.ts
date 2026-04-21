import type { ChatOptions, ChatResult, ChatStreamCallbacks, ModelOption, PluginMessage, ProviderPlugin, ThinkingCapability } from '../types';
import { toolsToAnthropic } from '../tool-schema';
import { fetchWithTimeout } from '../http';
import { consumeAnthropicStream } from './streams/anthropic-stream';
import { THINKING_BUDGETS, type ThinkLevel, type ThinkingStreamEvent } from '../../services/thinking';

const ANTHROPIC_VERSION = '2023-06-01';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

function toAnthropicMessages(messages: PluginMessage[]): any[] {
  return messages.map((m) => {
    if (m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.tool_calls.map((tc) => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.args,
          })),
        ],
      };
    }
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id,
          content: m.content || '',
        }],
      };
    }
    return { role: m.role, content: m.content || '' };
  });
}

async function listModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Chave de API inválida ou sem permissão');
    }
    throw new Error(`Anthropic API Error: ${await response.text()}`);
  }
  const data = await response.json();
  return data.data
    .filter((m: any) => m.type === 'model' && m.id.includes('claude'))
    .map((m: any) => ({ id: m.id, name: m.display_name || m.id }));
}

function buildAnthropicBody(opts: ChatOptions): any {
  const { model, systemPrompt, messages, tools, maxTokens, temperature } = opts;
  const body: any = {
    model,
    max_tokens: maxTokens || 4096,
    system: systemPrompt,
    messages: toAnthropicMessages(messages),
  };
  if (tools && tools.length > 0) body.tools = toolsToAnthropic(tools);
  if (typeof temperature === 'number') body.temperature = temperature;
  return body;
}

async function chat(opts: ChatOptions): Promise<ChatResult> {
  const { configs } = opts;
  if (!configs.anthropicKey) throw new Error('Anthropic API Key is missing');

  const body = buildAnthropicBody(opts);

  const response = await fetchWithTimeout(MESSAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': configs.anthropicKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`Anthropic API Error: ${await response.text()}`);
  const data = await response.json();
  if (!data.content || data.content.length === 0) throw new Error('Claude returned no content');

  const toolCalls = data.content
    .filter((c: any) => c.type === 'tool_use')
    .map((c: any) => ({ id: c.id, name: c.name, args: c.input }));

  if (toolCalls.length > 0) return { tool_calls: toolCalls };

  // Pick first text block; strip eventual markdown fences so downstream JSON parsers work.
  const textBlock = data.content.find((c: any) => c.type === 'text' || typeof c.text === 'string');
  const raw = (textBlock?.text || data.content[0].text || '').trim();
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  return { content: cleaned };
}

const anthropicThinkingCapability = createAnthropicThinkingCapability();

async function chatStream(opts: ChatOptions, cb: ChatStreamCallbacks): Promise<string> {
  const { configs, thinkingLevel } = opts;
  if (!configs.anthropicKey) throw new Error('Anthropic API Key is missing');

  const body: any = { ...buildAnthropicBody(opts), stream: true };
  if (thinkingLevel && anthropicThinkingCapability.supported.includes(thinkingLevel)) {
    Object.assign(body, anthropicThinkingCapability.toRequestOptions(thinkingLevel, opts.model));
  }

  const response = await fetchWithTimeout(MESSAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': configs.anthropicKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  }, 300_000);

  const raw = await consumeAnthropicStream(response, anthropicThinkingCapability, cb);
  return raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
}

export function createAnthropicThinkingCapability(): ThinkingCapability {
  return {
    supported: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'],
    default: 'medium',
    toRequestOptions(level: ThinkLevel) {
      if (level === 'off') return {};
      const budget = THINKING_BUDGETS[level] || THINKING_BUDGETS.medium;
      return { thinking: { type: 'enabled', budget_tokens: budget } };
    },
    parseStreamChunk(chunk: unknown): ThinkingStreamEvent[] {
      const events: ThinkingStreamEvent[] = [];
      if (!chunk || typeof chunk !== 'object') return events;
      const c = chunk as any;
      if (c.type === 'content_block_start' && c.content_block?.type === 'thinking') {
        events.push({ type: 'thinking-start' });
      } else if (c.type === 'content_block_delta') {
        if (c.delta?.type === 'thinking_delta' && typeof c.delta.thinking === 'string') {
          events.push({ type: 'thinking-chunk', text: c.delta.thinking });
        } else if (c.delta?.type === 'text_delta' && typeof c.delta.text === 'string') {
          events.push({ type: 'response-chunk', text: c.delta.text });
        }
      } else if (c.type === 'content_block_stop' && c.index === 0) {
        // First block end often coincides with thinking block end on Claude
        events.push({ type: 'thinking-end' });
      } else if (c.type === 'message_stop') {
        events.push({ type: 'response-end' });
      }
      return events;
    },
  };
}

/**
 * Spec 08 recommendations. Anthropic shines at planning/reasoning via Opus
 * and Sonnet tiers; Haiku is the cheap synthesizer/utility pick. We pick
 * the newest available model in each tier by lexicographic date sort.
 */
function pickAnthropic(models: string[], tierRegex: RegExp): string | null {
  const matches = models.filter((m) => tierRegex.test(m));
  if (matches.length === 0) return null;
  return matches.sort().reverse()[0];
}

function recommendAnthropic(role: 'planner' | 'executor' | 'synthesizer' | 'utility' | 'digest', models: string[]) {
  if (role === 'planner') {
    const opus = pickAnthropic(models, /claude.*opus/i);
    if (opus) return { model: opus, thinkingLevel: 'high' as const, notes: 'Top-tier reasoning for planning and tool choice.' };
    const sonnet = pickAnthropic(models, /claude.*sonnet/i);
    if (sonnet) return { model: sonnet, thinkingLevel: 'medium' as const, notes: 'Strong reasoning, balanced cost.' };
    return null;
  }
  if (role === 'synthesizer' || role === 'utility') {
    const haiku = pickAnthropic(models, /claude.*haiku/i);
    if (haiku) return { model: haiku, thinkingLevel: 'off' as const, notes: 'Fast and cheap for synthesis and internal tasks.' };
    const sonnet = pickAnthropic(models, /claude.*sonnet/i);
    if (sonnet) return { model: sonnet, thinkingLevel: 'off' as const };
    return null;
  }
  if (role === 'digest') {
    const haiku = pickAnthropic(models, /claude.*haiku/i);
    if (haiku) return { model: haiku, thinkingLevel: 'off' as const, notes: 'Cheapest cloud pick for bulk digest. A local Ollama model is preferred when available.' };
    return null;
  }
  return null;
}

export function createAnthropicProvider(): ProviderPlugin {
  return {
    id: 'anthropic',
    label: 'Anthropic Claude',
    matches: (model) => model.includes('claude'),
    listModels,
    chat,
    chatStream,
    capabilities: { thinking: anthropicThinkingCapability },
    recommendedFor: {
      planner: (models) => recommendAnthropic('planner', models),
      synthesizer: (models) => recommendAnthropic('synthesizer', models),
      utility: (models) => recommendAnthropic('utility', models),
      digest: (models) => recommendAnthropic('digest', models),
    },
  };
}

