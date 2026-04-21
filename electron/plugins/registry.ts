/**
 * In-memory plugin registry. Keeps providers and tools in Maps and exposes
 * lookup helpers used by `llmService`, `providerService`, and tool executors.
 */
import type {
  ProviderPlugin,
  ToolPlugin,
  PluginApi,
} from './types';
import { createAnthropicProvider } from './providers/anthropic';
import { createOpenAiProvider } from './providers/openai';
import { createGoogleProvider } from './providers/google';
import { createOllamaProvider, createOllamaCloudProvider } from './providers/ollama';

const providers = new Map<string, ProviderPlugin>();
const tools = new Map<string, ToolPlugin>();

export const pluginApi: PluginApi = {
  registerProvider(plugin) {
    providers.set(plugin.id, plugin);
  },
  registerTool(plugin) {
    tools.set(plugin.name, plugin);
  },
  unregisterTool(name) {
    tools.delete(name);
  },
};

export function getProvider(id: string): ProviderPlugin | undefined {
  return providers.get(id);
}

export function listProviders(): ProviderPlugin[] {
  return Array.from(providers.values());
}

/**
 * Resolve the first provider whose `matches(model)` returns true.
 * Order is insertion order — specific plugins (e.g. `ollama-cloud`) should
 * be registered before generic ones (`ollama`) when prefixes overlap.
 */
export function getProviderForModel(model: string): ProviderPlugin {
  for (const p of providers.values()) {
    if (p.matches(model)) return p;
  }
  throw new Error(`No provider plugin matches model: ${model}`);
}

export function getTool(name: string): ToolPlugin | undefined {
  return tools.get(name);
}

export function listTools(): ToolPlugin[] {
  return Array.from(tools.values());
}

/** Used by tests to start from a clean slate. */
export function resetRegistry(): void {
  providers.clear();
  tools.clear();
  builtinsLoaded = false;
}

let builtinsLoaded = false;

/**
 * Registers the built-in providers and tools. Safe to call multiple times —
 * subsequent calls are no-ops unless `resetRegistry` was called first.
 */
export function loadBuiltins(): void {
  if (builtinsLoaded) return;
  builtinsLoaded = true;

  // Order matters for `getProviderForModel`: cloud prefix before local.
  pluginApi.registerProvider(createOllamaCloudProvider());
  pluginApi.registerProvider(createOllamaProvider());
  pluginApi.registerProvider(createAnthropicProvider());
  pluginApi.registerProvider(createGoogleProvider());
  pluginApi.registerProvider(createOpenAiProvider());
}

