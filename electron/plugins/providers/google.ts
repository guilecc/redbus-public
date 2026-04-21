import type { ChatOptions, ChatResult, ChatStreamCallbacks, ModelOption, PluginMessage, ProviderPlugin, ThinkingCapability } from '../types';
import { toolsToGemini } from '../tool-schema';
import { fetchWithTimeout } from '../http';
import { consumeGoogleStream } from './streams/google-stream';
import { THINKING_BUDGETS, type ThinkLevel, type ThinkingStreamEvent } from '../../services/thinking';

function toGeminiContents(messages: PluginMessage[]): any[] {
  return messages.map((m) => {
    if (m.tool_calls && m.tool_calls.length > 0) {
      const tc = m.tool_calls[0];
      return {
        role: 'model',
        parts: [{
          functionCall: { name: tc.name, args: tc.args },
          thoughtSignature: tc.thoughtSignature || 'skip_thought_signature_validator',
        }],
      };
    }
    if (m.role === 'tool') {
      return {
        role: 'user',
        parts: [{
          functionResponse: { name: m.name, response: { name: m.name, content: m.content || '' } },
        }],
      };
    }
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }],
    };
  });
}

async function listModels(apiKey: string): Promise<ModelOption[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 400 || response.status === 403) {
      throw new Error('Chave de API inválida ou sem permissão');
    }
    throw new Error(`Google API Error: ${await response.text()}`);
  }
  const data = await response.json();
  return data.models
    .filter((m: any) => m.name.includes('gemini'))
    .map((m: any) => ({
      id: m.name.replace('models/', ''),
      name: m.displayName || m.name.replace('models/', ''),
    }))
    .sort((a: ModelOption, b: ModelOption) => b.id.localeCompare(a.id));
}

function buildGeminiBody(opts: ChatOptions): any {
  const { systemPrompt, messages, tools, responseFormat, temperature } = opts;
  const body: any = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: toGeminiContents(messages),
  };
  if (tools && tools.length > 0) body.tools = toolsToGemini(tools);
  if (responseFormat === 'json_object') {
    body.generationConfig = { ...(body.generationConfig || {}), responseMimeType: 'application/json' };
  }
  if (typeof temperature === 'number') {
    body.generationConfig = { ...(body.generationConfig || {}), temperature };
  }
  return body;
}

async function chat(opts: ChatOptions): Promise<ChatResult> {
  const { model, configs, thinkingLevel, tools, messages, systemPrompt } = opts;
  if (!configs.googleKey) throw new Error('Google API Key is missing');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${configs.googleKey}`;

  const body: any = buildGeminiBody(opts);
  if (thinkingLevel && googleThinkingCapability.supported.includes(thinkingLevel)) {
    const thinkOpts = googleThinkingCapability.toRequestOptions(thinkingLevel, model) as any;
    if (thinkOpts.generationConfig) {
      body.generationConfig = { ...(body.generationConfig || {}), ...thinkOpts.generationConfig };
    }
  }

  const payload = JSON.stringify(body);
  const thinkingBudget = body.generationConfig?.thinkingConfig?.thinkingBudget;
  console.log(`[GoogleChat] → ${model} msgs=${messages.length} tools=${tools?.length ?? 0} sys=${systemPrompt?.length ?? 0}B payload=${payload.length}B think=${thinkingLevel ?? '-'}${thinkingBudget !== undefined ? `(budget=${thinkingBudget})` : ''}`);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }, 300_000);
  } catch (err: any) {
    const ms = Date.now() - startedAt;
    console.error(`[GoogleChat] ✗ ${model} network error after ${ms}ms: ${err?.message || err}`);
    throw err;
  }

  const ms = Date.now() - startedAt;
  if (!response.ok) {
    const body = await response.text();
    console.error(`[GoogleChat] ✗ ${model} http ${response.status} after ${ms}ms: ${body.slice(0, 400)}`);
    throw new Error(`Google API Error: ${body}`);
  }
  const data = await response.json();
  const usage = data.usageMetadata || {};
  const finish = data.candidates?.[0]?.finishReason || '?';
  if (!data.candidates || data.candidates.length === 0) {
    console.error(`[GoogleChat] ✗ ${model} no candidates after ${ms}ms: ${JSON.stringify(data).slice(0, 400)}`);
    throw new Error(`Gemini no candidates. Response: ${JSON.stringify(data)}`);
  }
  const parts: any[] = data.candidates[0].content?.parts || [];
  if (parts.length === 0) {
    console.error(`[GoogleChat] ✗ ${model} empty parts after ${ms}ms (finish=${finish})`);
    throw new Error('Gemini returned empty parts');
  }

  // When `includeThoughts` is on, Gemini emits the thought summary as a
  // separate part with `thought: true`. Skip those to find the real payload.
  const functionCallPart = parts.find((p) => p.functionCall);
  const textPart = parts.find((p) => !p.thought && typeof p.text === 'string');

  const kind = functionCallPart
    ? `tool_call=${functionCallPart.functionCall.name}`
    : `text=${(textPart?.text || '').length}B`;
  console.log(`[GoogleChat] ← ${model} ${ms}ms finish=${finish} parts=${parts.length} ${kind} prompt_tok=${usage.promptTokenCount ?? '?'} out_tok=${usage.candidatesTokenCount ?? '?'} thought_tok=${usage.thoughtsTokenCount ?? 0}`);

  if (functionCallPart) {
    return {
      tool_calls: [{
        name: functionCallPart.functionCall.name,
        args: functionCallPart.functionCall.args,
        thoughtSignature: functionCallPart.thoughtSignature || functionCallPart.thought_signature,
      }],
    };
  }
  return { content: textPart?.text || '' };
}

/** Gemini 2.5+ exposes `thinkingConfig` with `thinkingBudget` (-1 = adaptive,
 *  0 = off, n = max thinking tokens) and `includeThoughts`. The `-latest`
 *  aliases (`gemini-pro-latest`, `gemini-flash-latest`) currently resolve to
 *  2.5-series snapshots, so they also accept the thinking payload. */
function isThinkingCapableGemini(model: string): boolean {
  const m = model.toLowerCase();
  return /gemini-2\.5|gemini-3|gemini-(pro|flash|flash-lite)-latest/.test(m);
}

function createGoogleThinkingCapability(): ThinkingCapability {
  return {
    supported: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'],
    default: 'adaptive',
    toRequestOptions(level: ThinkLevel, model: string) {
      if (!isThinkingCapableGemini(model)) return {};
      if (level === 'off') {
        return { generationConfig: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } } };
      }
      if (level === 'adaptive') {
        return { generationConfig: { thinkingConfig: { thinkingBudget: -1, includeThoughts: true } } };
      }
      const budget = THINKING_BUDGETS[level] || THINKING_BUDGETS.medium;
      return { generationConfig: { thinkingConfig: { thinkingBudget: budget, includeThoughts: true } } };
    },
    parseStreamChunk(chunk: unknown): ThinkingStreamEvent[] {
      const events: ThinkingStreamEvent[] = [];
      if (!chunk || typeof chunk !== 'object') return events;
      const c = chunk as any;
      const parts = c.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (typeof p?.text !== 'string' || p.text.length === 0) continue;
        if (p.thought === true) {
          events.push({ type: 'thinking-chunk', text: p.text });
        } else {
          events.push({ type: 'response-chunk', text: p.text });
        }
      }
      if (c.candidates?.[0]?.finishReason) events.push({ type: 'response-end' });
      return events;
    },
  };
}

const googleThinkingCapability = createGoogleThinkingCapability();

async function chatStream(opts: ChatOptions, cb: ChatStreamCallbacks): Promise<string> {
  const { configs, model, thinkingLevel, tools, messages, systemPrompt } = opts;
  if (!configs.googleKey) throw new Error('Google API Key is missing');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${configs.googleKey}`;
  const body: any = buildGeminiBody(opts);
  if (thinkingLevel && googleThinkingCapability.supported.includes(thinkingLevel)) {
    const thinkOpts = googleThinkingCapability.toRequestOptions(thinkingLevel, model) as any;
    if (thinkOpts.generationConfig) {
      body.generationConfig = { ...(body.generationConfig || {}), ...thinkOpts.generationConfig };
    }
  }

  const payload = JSON.stringify(body);
  const thinkingBudget = body.generationConfig?.thinkingConfig?.thinkingBudget;
  console.log(`[GoogleStream] → ${model} msgs=${messages.length} tools=${tools?.length ?? 0} sys=${systemPrompt?.length ?? 0}B payload=${payload.length}B think=${thinkingLevel ?? '-'}${thinkingBudget !== undefined ? `(budget=${thinkingBudget})` : ''}`);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }, 300_000);
  } catch (err: any) {
    const ms = Date.now() - startedAt;
    console.error(`[GoogleStream] ✗ ${model} network error after ${ms}ms: ${err?.message || err}`);
    throw err;
  }

  if (!response.ok) {
    const ms = Date.now() - startedAt;
    const body = await response.text();
    console.error(`[GoogleStream] ✗ ${model} http ${response.status} after ${ms}ms: ${body.slice(0, 400)}`);
    throw new Error(`Google API Error: ${body}`);
  }

  const text = await consumeGoogleStream(response, googleThinkingCapability, cb);
  console.log(`[GoogleStream] ← ${model} ${Date.now() - startedAt}ms out=${text.length}B`);
  return text;
}

/**
 * Spec 08 recommendations. Gemini Flash is the default executor — fast,
 * cheap, strong tool-use. Pro is the planner pick when no Anthropic key is
 * available.
 */
function pickGoogle(models: string[], re: RegExp): string | null {
  const m = models.filter((id) => re.test(id));
  if (m.length === 0) return null;
  return m.sort().reverse()[0];
}

function recommendGoogle(role: 'planner' | 'executor' | 'synthesizer' | 'utility' | 'digest', models: string[]) {
  if (role === 'executor') {
    const flash = pickGoogle(models, /gemini.*flash/i);
    if (flash) return { model: flash, thinkingLevel: 'off' as const, notes: 'Fast executor with strong tool-use.' };
    return null;
  }
  if (role === 'planner') {
    const pro = pickGoogle(models, /gemini.*pro/i);
    if (pro) return { model: pro, thinkingLevel: 'medium' as const, notes: 'Solid reasoning; good fallback planner.' };
    return null;
  }
  if (role === 'synthesizer' || role === 'utility') {
    const flash = pickGoogle(models, /gemini.*flash/i);
    if (flash) return { model: flash, thinkingLevel: 'off' as const, notes: 'Cheap and quick for synthesis.' };
    return null;
  }
  if (role === 'digest') {
    const flash = pickGoogle(models, /gemini.*flash/i);
    if (flash) return { model: flash, thinkingLevel: 'off' as const, notes: 'Cheap pick for bulk digest. A local Ollama model is preferred when available.' };
    return null;
  }
  return null;
}

export function createGoogleProvider(): ProviderPlugin {
  return {
    id: 'google',
    label: 'Google Gemini',
    matches: (model) => model.includes('gemini'),
    listModels,
    chat,
    chatStream,
    capabilities: { thinking: googleThinkingCapability },
    recommendedFor: {
      planner: (models) => recommendGoogle('planner', models),
      executor: (models) => recommendGoogle('executor', models),
      synthesizer: (models) => recommendGoogle('synthesizer', models),
      utility: (models) => recommendGoogle('utility', models),
      digest: (models) => recommendGoogle('digest', models),
    },
  };
}

