/**
 * Helpers for serializing `ToolPlugin` into LLM-native tool schemas.
 *
 * Providers accept different shapes — Anthropic uses `input_schema`, OpenAI
 * wraps in `{ type: 'function', function: { parameters } }`, Gemini groups
 * everything in `function_declarations`. These helpers centralize the
 * translation so each provider plugin stays short.
 */
import type { PluginToolSchema, ToolPlugin } from './types';

export function toolPluginToSchema(tool: ToolPlugin): PluginToolSchema {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters || { type: 'object', properties: {} },
  };
}

export function toolsToOpenAi(tools: PluginToolSchema[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export function toolsToAnthropic(tools: PluginToolSchema[]): any[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

export function toolsToGemini(tools: PluginToolSchema[]): any[] {
  return [
    {
      function_declarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      })),
    },
  ];
}

