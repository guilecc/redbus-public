/**
 * Thin facade — delegates model discovery to the matching ProviderPlugin.
 * Provider-specific endpoints and filters live in `electron/plugins/providers/*`.
 */
import { getProvider, loadBuiltins } from '../plugins/registry';
import type { ModelOption } from '../plugins/types';

loadBuiltins();

export type { ModelOption };

export async function fetchAvailableModels(
  provider: string,
  apiKey: string,
  customUrl?: string
): Promise<ModelOption[]> {
  if (!apiKey) throw new Error('API Key is required to fetch models');
  const plugin = getProvider(provider);
  if (!plugin) throw new Error(`Unknown provider: ${provider}`);
  return plugin.listModels(apiKey, customUrl);
}

