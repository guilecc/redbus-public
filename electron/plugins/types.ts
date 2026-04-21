/**
 * Plugin contract inspired by `oc/src/plugins/types.ts`.
 *
 * Providers and tools are registered via `PluginApi` and resolved through
 * the in-memory `registry`. Each plugin owns its provider-specific quirks
 * (endpoints, auth headers, message/tool serialization, response shape).
 */

import type { ThinkLevel, ThinkingStreamEvent } from '../services/thinking';

// ── LLM messages / tools ──

export type PluginMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface PluginToolCall {
  id?: string;
  name: string;
  args: any;
  /** Gemini-only: preserved across turns so function calls stay valid. */
  thoughtSignature?: string;
}

export interface PluginMessage {
  role: PluginMessageRole;
  content?: string;
  tool_calls?: PluginToolCall[];
  /** When role === 'tool': id of the assistant tool_call this message replies to. */
  tool_call_id?: string;
  /** When role === 'tool': name of the tool being responded to. */
  name?: string;
}

export interface PluginToolSchema {
  name: string;
  description: string;
  /** Raw JSON Schema (OpenAI/Anthropic `input_schema` shape). */
  input_schema: any;
}

// ── Chat options / result (provider-agnostic) ──

export interface ChatOptions {
  /** Full model id (e.g. `claude-3-5-haiku`, `ollama/llama3`, `gemini-2.5-flash`). */
  model: string;
  /** ProviderConfigs row from the DB — contains keys and custom URLs. */
  configs: Record<string, any>;
  systemPrompt: string;
  messages: PluginMessage[];
  /** JSON-Schema tool declarations — plugin serializes to its native shape. */
  tools?: PluginToolSchema[];
  /** Force a JSON object response when supported. */
  responseFormat?: 'json_object';
  maxTokens?: number;
  /** Sampling temperature. Omitted when undefined so provider defaults apply. */
  temperature?: number;
  /** Request id for stream event correlation (only used by chatStream). */
  requestId?: string | null;
  /** Canonical thinking level — provider plugin maps to its native payload. */
  thinkingLevel?: ThinkLevel;
}

export interface ChatResult {
  content?: string;
  tool_calls?: PluginToolCall[];
}

// ── Streaming ──

export interface ChatStreamCallbacks {
  onThinkingStart?: () => void;
  onThinkingChunk?: (text: string) => void;
  onThinkingEnd?: () => void;
  onTextChunk?: (text: string) => void;
}

// ── Plugin types ──

export interface ModelOption {
  id: string;
  name: string;
}

export interface ThinkingCapability {
  /** Subset of canonical levels actually supported (always includes 'off'). */
  supported: ThinkLevel[];
  /** Default level when none configured. */
  default: ThinkLevel;
  /** Translates the canonical level to the provider's native payload fragment. */
  toRequestOptions: (level: ThinkLevel, model: string) => Record<string, unknown>;
  /** Parses a vendor-specific stream chunk into canonical events. */
  parseStreamChunk: (chunk: unknown) => ThinkingStreamEvent[];
}

export interface ProviderCapabilities {
  thinking?: ThinkingCapability;
}

/**
 * Per-role recommendation from a provider plugin (Spec 08). Given the list
 * of models the user can actually reach, the provider suggests the best
 * fit for a semantic role. Returning `null` means this provider has no
 * model appropriate for that role.
 */
export interface ModelRecommendation {
  model: string;
  thinkingLevel?: ThinkLevel;
  /** Human-readable reason shown in the onboarding review screen. */
  notes?: string;
}

export type RecommendedForMap = {
  planner?: (availableModels: string[]) => ModelRecommendation | null;
  executor?: (availableModels: string[]) => ModelRecommendation | null;
  synthesizer?: (availableModels: string[]) => ModelRecommendation | null;
  utility?: (availableModels: string[]) => ModelRecommendation | null;
  digest?: (availableModels: string[]) => ModelRecommendation | null;
};

export interface ProviderPlugin {
  /** Short identifier: `anthropic`, `openai`, `google`, `ollama`, `ollama-cloud`. */
  id: string;
  label: string;
  /**
   * Returns true when this plugin can handle the given full model id.
   * Used by the registry to route chat calls based on model string alone.
   */
  matches: (model: string) => boolean;
  /** Fetches the list of available models for the given api key. */
  listModels: (apiKey: string, customUrl?: string) => Promise<ModelOption[]>;
  /** Single-shot chat, returns text or tool_calls. */
  chat: (opts: ChatOptions) => Promise<ChatResult>;
  /**
   * Optional — streams thinking/text chunks via callbacks and resolves with
   * the final accumulated text. Used by the maestro/synthesis paths.
   */
  chatStream?: (opts: ChatOptions, cb: ChatStreamCallbacks) => Promise<string>;
  /** Optional capabilities (thinking, vision, …). Per-model resolution happens
   *  inside the capability functions when needed. */
  capabilities?: ProviderCapabilities;
  /**
   * Onboarding helper (Spec 08). Each entry picks the best model from the
   * `availableModels` list for a given semantic role, or returns `null`
   * when no suitable model is reachable for this provider.
   */
  recommendedFor?: RecommendedForMap;
}

export interface ToolContext {
  db: any;
  requestId?: string | null;
  /** Depth of the current agent loop — 0 for top-level, ≥1 inside a subagent. */
  agentDepth?: number;
  [k: string]: any;
}

export interface ToolPlugin {
  name: string;
  label?: string;
  description: string;
  /** Raw JSON Schema object for the tool parameters. */
  parameters: any;
  /** Executes the tool. Returns the raw value sent back as a tool message content. */
  execute: (toolCallId: string | null, params: any, ctx: ToolContext) => Promise<any>;
}

// ── Public registration API ──

export interface PluginApi {
  registerProvider(plugin: ProviderPlugin): void;
  registerTool(plugin: ToolPlugin): void;
  unregisterTool(name: string): void;
}

export interface PluginEntry {
  id: string;
  name?: string;
  description?: string;
  register: (api: PluginApi) => void;
}

export function definePluginEntry(entry: PluginEntry): PluginEntry {
  return entry;
}

