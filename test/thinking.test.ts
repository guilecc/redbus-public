import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeThinkLevel, THINKING_BUDGETS } from '../electron/services/thinking';
import { resetRegistry, loadBuiltins, getProvider } from '../electron/plugins/registry';

beforeEach(() => {
  resetRegistry();
  loadBuiltins();
});

describe('normalizeThinkLevel — aliases', () => {
  it('maps canonical levels to themselves', () => {
    expect(normalizeThinkLevel('off')).toBe('off');
    expect(normalizeThinkLevel('minimal')).toBe('minimal');
    expect(normalizeThinkLevel('low')).toBe('low');
    expect(normalizeThinkLevel('medium')).toBe('medium');
    expect(normalizeThinkLevel('high')).toBe('high');
    expect(normalizeThinkLevel('xhigh')).toBe('xhigh');
    expect(normalizeThinkLevel('adaptive')).toBe('adaptive');
  });

  it('maps common aliases to canonical levels', () => {
    expect(normalizeThinkLevel('none')).toBe('off');
    expect(normalizeThinkLevel('disabled')).toBe('off');
    expect(normalizeThinkLevel('ultrathink')).toBe('high');
    expect(normalizeThinkLevel('ultra')).toBe('high');
    expect(normalizeThinkLevel('max')).toBe('high');
    expect(normalizeThinkLevel('thinkharder')).toBe('medium');
    expect(normalizeThinkLevel('auto')).toBe('adaptive');
    expect(normalizeThinkLevel('extra-high')).toBe('xhigh');
    expect(normalizeThinkLevel('ON')).toBe('low');
  });

  it('handles booleans and numbers', () => {
    expect(normalizeThinkLevel(true)).toBe('low');
    expect(normalizeThinkLevel(false)).toBe('off');
    expect(normalizeThinkLevel(0)).toBe('off');
    expect(normalizeThinkLevel(1)).toBe('medium');
  });

  it('falls back for unknown input', () => {
    expect(normalizeThinkLevel('nonsense')).toBe('medium');
    expect(normalizeThinkLevel('nonsense', 'high')).toBe('high');
    expect(normalizeThinkLevel(null)).toBe('medium');
    expect(normalizeThinkLevel(undefined, 'off')).toBe('off');
  });
});

describe('ThinkingCapability.parseStreamChunk per provider', () => {
  it('anthropic emits thinking-chunk for thinking_delta and response-chunk for text_delta', () => {
    const cap = getProvider('anthropic')!.capabilities!.thinking!;
    const think = cap.parseStreamChunk({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'let me think…' } });
    expect(think).toEqual([{ type: 'thinking-chunk', text: 'let me think…' }]);
    const text = cap.parseStreamChunk({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'final answer' } });
    expect(text).toEqual([{ type: 'response-chunk', text: 'final answer' }]);
    const start = cap.parseStreamChunk({ type: 'content_block_start', content_block: { type: 'thinking' } });
    expect(start).toEqual([{ type: 'thinking-start' }]);
  });

  it('openai emits thinking-chunk from reasoning_content and response-chunk from content', () => {
    const cap = getProvider('openai')!.capabilities!.thinking!;
    const think = cap.parseStreamChunk({ choices: [{ delta: { reasoning_content: 'step 1' } }] });
    expect(think).toEqual([{ type: 'thinking-chunk', text: 'step 1' }]);
    const text = cap.parseStreamChunk({ choices: [{ delta: { content: 'hello' } }] });
    expect(text).toEqual([{ type: 'response-chunk', text: 'hello' }]);
  });

  it('google emits thinking-chunk for parts flagged with thought:true', () => {
    const cap = getProvider('google')!.capabilities!.thinking!;
    const events = cap.parseStreamChunk({
      candidates: [{ content: { parts: [
        { text: 'inner', thought: true },
        { text: 'outer' },
      ] } }],
    });
    expect(events).toEqual([
      { type: 'thinking-chunk', text: 'inner' },
      { type: 'response-chunk', text: 'outer' },
    ]);
  });

  it('ollama emits thinking-chunk for message.thinking and response-chunk for message.content', () => {
    const cap = getProvider('ollama')!.capabilities!.thinking!;
    const events = cap.parseStreamChunk({ message: { thinking: 'reasoning…', content: 'done' } });
    expect(events).toEqual([
      { type: 'thinking-chunk', text: 'reasoning…' },
      { type: 'response-chunk', text: 'done' },
    ]);
  });
});

describe('ThinkingCapability.toRequestOptions per provider', () => {
  it('anthropic returns budget_tokens payload', () => {
    const cap = getProvider('anthropic')!.capabilities!.thinking!;
    const opts = cap.toRequestOptions('high', 'claude-3-7-sonnet-20250219') as any;
    expect(opts.thinking).toEqual({ type: 'enabled', budget_tokens: THINKING_BUDGETS.high });
    expect(cap.toRequestOptions('off', 'claude-3-7-sonnet-20250219')).toEqual({});
  });

  it('openai returns reasoning_effort only for reasoning models', () => {
    const cap = getProvider('openai')!.capabilities!.thinking!;
    expect(cap.toRequestOptions('high', 'o3-mini')).toEqual({ reasoning_effort: 'high' });
    expect(cap.toRequestOptions('high', 'gpt-4o')).toEqual({});
  });

  it('google returns thinkingConfig for 2.5+ models only', () => {
    const cap = getProvider('google')!.capabilities!.thinking!;
    const gem25 = cap.toRequestOptions('adaptive', 'gemini-2.5-flash') as any;
    expect(gem25.generationConfig.thinkingConfig.thinkingBudget).toBe(-1);
    const gem15 = cap.toRequestOptions('high', 'gemini-1.5-pro');
    expect(gem15).toEqual({});
  });

  it('ollama returns think option only for reasoning-like models', () => {
    const cap = getProvider('ollama')!.capabilities!.thinking!;
    expect(cap.toRequestOptions('medium', 'deepseek-r1:7b')).toEqual({ think: 'medium' });
    expect(cap.toRequestOptions('medium', 'llama3:8b')).toEqual({});
    expect(cap.toRequestOptions('off', 'deepseek-r1:7b')).toEqual({});
  });
});

