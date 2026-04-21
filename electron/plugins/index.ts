/**
 * Public entry point for the plugin system. Importing this module ensures
 * the built-in providers (Anthropic, OpenAI, Google, Ollama, Ollama Cloud)
 * are registered in the in-memory registry.
 */
import { loadBuiltins } from './registry';

loadBuiltins();

export * from './types';
export {
  pluginApi,
  getProvider,
  getProviderForModel,
  listProviders,
  getTool,
  listTools,
  resetRegistry,
  loadBuiltins,
} from './registry';
export { fetchWithTimeout } from './http';
export { callOllamaChat } from './providers/ollama';
export { chatWithStream } from './chat-stream';

