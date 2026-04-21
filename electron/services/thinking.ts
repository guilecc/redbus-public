/**
 * Canonical thinking levels — single enum that flows UI → orchestrator
 * → provider plugin. Each provider's `ThinkingCapability.toRequestOptions`
 * translates to the native payload (Anthropic budget tokens, OpenAI
 * reasoning_effort, Gemini thinkingBudget, Ollama think).
 *
 * Inspired by `oc/src/auto-reply/thinking.shared.ts`.
 */

export type ThinkLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'adaptive';

export const ALL_THINK_LEVELS: ThinkLevel[] = [
  'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive',
];

/**
 * Canonical alias map. Keys are normalized (lower-case, dashes/underscores
 * collapsed); values are the canonical level. Mirrors the popular aliases
 * used by `oc/`.
 */
const ALIASES: Record<string, ThinkLevel> = {
  // off
  'off': 'off',
  'none': 'off',
  'disabled': 'off',
  'disable': 'off',
  'false': 'off',
  '0': 'off',
  'no': 'off',
  // minimal
  'minimal': 'minimal',
  'min': 'minimal',
  'tiny': 'minimal',
  // low (also: on/enable)
  'low': 'low',
  'on': 'low',
  'enable': 'low',
  'enabled': 'low',
  'true': 'low',
  '1': 'low',
  'yes': 'low',
  'light': 'low',
  // medium (also: think-harder/harder)
  'medium': 'medium',
  'med': 'medium',
  'mid': 'medium',
  'normal': 'medium',
  'standard': 'medium',
  'thinkharder': 'medium',
  'harder': 'medium',
  // high (also: ultrathink/highest/max)
  'high': 'high',
  'hi': 'high',
  'ultrathink': 'high',
  'ultra': 'high',
  'highest': 'high',
  'max': 'high',
  'maximum': 'high',
  // xhigh
  'xhigh': 'xhigh',
  'extrahigh': 'xhigh',
  'xx': 'xhigh',
  'extreme': 'xhigh',
  // adaptive (also: auto)
  'adaptive': 'adaptive',
  'auto': 'adaptive',
  'dynamic': 'adaptive',
};

/**
 * Normalize any user/setting/CLI string into a canonical `ThinkLevel`.
 * Returns `fallback` when the input is unrecognized.
 */
export function normalizeThinkLevel(
  raw: unknown,
  fallback: ThinkLevel = 'medium',
): ThinkLevel {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'boolean') return raw ? 'low' : 'off';
  if (typeof raw === 'number') return raw > 0 ? 'medium' : 'off';
  const key = String(raw).toLowerCase().replace(/[\s_-]+/g, '');
  if (key in ALIASES) return ALIASES[key];
  return fallback;
}

/**
 * Canonical budget-token presets used by Anthropic (`thinking.budget_tokens`)
 * and Gemini (`thinkingConfig.thinkingBudget`). Centralized so providers stay
 * consistent.
 */
export const THINKING_BUDGETS: Record<ThinkLevel, number> = {
  off: 0,
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
  // Adaptive defers to the provider — use medium as a sensible numeric fallback.
  adaptive: 8192,
};

/** Canonical events emitted by `ThinkingCapability.parseStreamChunk`. */
export type ThinkingStreamEvent =
  | { type: 'thinking-start' }
  | { type: 'thinking-chunk'; text: string }
  | { type: 'thinking-end' }
  | { type: 'response-chunk'; text: string }
  | { type: 'response-end' };

