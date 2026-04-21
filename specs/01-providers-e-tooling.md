# Spec 01 — Providers LLM + Tool Calling via Plugins

## Objetivo

Substituir o acoplamento direto a providers/tools em `llmService.ts` e
`providerService.ts` por um **registry de plugins** inspirado em
`oc/src/plugins/types.ts`, permitindo:

- Adicionar novos providers (Anthropic, OpenAI, Google, Ollama, custom OpenAI-
  compat) sem tocar no core.
- Registrar tools (forge snippets, web search, filesystem, etc.) de forma
  declarativa e tipada, com schema JSON/TypeBox.
- Isolar quirks por provider (base URL, headers, normalização de modelo,
  tool-call format) em cada plugin.

## Estado atual (`redbus`)

- `providerService.fetchAvailableModels` tem `if (provider === 'openai' | 'anthropic' | 'google' | 'ollama-cloud')` hardcoded.
- `llmService.ts` tem caminhos separados por provider (`callOllamaChat`,
  chamadas Anthropic, etc.) com ~700 linhas.
- Tools do forge (snippets executáveis) ficam no DB e são chamados por código
  imperativo — não existe conceito de "ferramenta registrada" com schema.

## Padrão de inspiração (`oc/`)

### 1. Contrato `ProviderPlugin` (oc/src/plugins/types.ts:1051)

Cada provider expõe **hooks** finos em vez de herdar de uma classe:

```ts
type ProviderPlugin = {
  id: string;
  label: string;
  auth: ProviderAuthMethod[];
  catalog?: ProviderPluginCatalog;           // lista modelos
  resolveDynamicModel?: (ctx) => ProviderRuntimeModel | null;
  normalizeResolvedModel?: (ctx) => ProviderRuntimeModel | null;
  normalizeTransport?: (ctx) => { api?, baseUrl? } | null;
  normalizeConfig?: (ctx) => ModelProviderConfig | null;
  // ...replay, compat, stream quirks
};
```

O core chama os hooks na ordem: *catálogo → dynamic → normalize → compat*.

### 2. Registro via `PluginApi` (oc/src/plugins/types.ts:1885)

```ts
api.registerProvider(myProvider);
api.registerTool(myTool, { name: "my_tool", optional: true });
api.registerWebSearchProvider(...);
```

### 3. Tool tipada com TypeBox (oc/extensions/firecrawl/src/firecrawl-search-tool.ts)

```ts
const Schema = Type.Object({ query: Type.String(), count: Type.Optional(...) });
export function createFirecrawlSearchTool(api) {
  return {
    name: "firecrawl_search",
    label: "Firecrawl Search",
    description: "...",
    parameters: Schema,                 // gera JSON Schema p/ o LLM
    execute: async (toolCallId, params) => jsonResult(await run(params)),
  };
}
```

### 4. Entry point de extensão (oc/extensions/firecrawl/index.ts)

Um arquivo `index.ts` por plugin com `definePluginEntry({ id, register(api) })`.

## Plano de migração no `redbus`

### Fase 1 — Núcleo de plugins (sem quebrar o existente)

1. Criar `electron/plugins/types.ts` com:
   - `ProviderPlugin` (id, label, listModels, chat, parseStream, tools).
   - `ToolPlugin` (name, description, parameters JSON Schema, execute).
   - `PluginApi` (registerProvider, registerTool, registerStreamTransformer).
2. Criar `electron/plugins/registry.ts` — Map in-memory + `loadBuiltins()`.
3. Criar `electron/plugins/types-tool.ts` usando **Zod** (já é dep do redbus; evita
   adicionar TypeBox) para schema → JSON Schema via `zod-to-json-schema`.

### Fase 2 — Extrair providers existentes como plugins

- `electron/plugins/providers/anthropic.ts` — empacota fetch + stream parser.
- `electron/plugins/providers/ollama.ts` — empacota `callOllamaChat`.
- `electron/plugins/providers/openai.ts`, `google.ts`.
- `llmService.ts` vira um **orchestrator** fino: `registry.get(providerId).chat(...)`.
- `providerService.fetchAvailableModels` delega a `provider.listModels(apiKey)`.

### Fase 3 — Tools declarativas

- Cada snippet do `ForgeSnippets` vira automaticamente um `ToolPlugin` cujo
  `parameters` é o `parameters_schema` da tabela e `execute` chama
  `forgeService.execSnippet`.
- Tools internas do app (send_email, create_task, read_inbox) migram de
  handlers ad-hoc em `llmService` para `ToolPlugin` registrados no boot.
- O prompt do sistema passa a ser montado a partir do registry:
  `registry.listTools().map(toLLMSchema)`.

### Fase 4 — Extensões de terceiros (opcional, posterior)

- Carregar `~/.redbus/plugins/*/index.js` no boot (require dinâmico, sandbox
  desabilitado por enquanto). Seguir padrão de `definePluginEntry` do `oc`.

## Critérios de sucesso

- `llmService.ts` < 200 linhas e sem `if (provider === ...)`.
- Adicionar um novo provider = criar 1 arquivo em `electron/plugins/providers/`.
- Adicionar uma nova tool = registrar em 1 lugar, com schema validado.
- Testes: para cada provider plugin, mock de `fetch` + assert de eventos no
  `streamBus`.

## Fora de escopo desta spec

- Sandbox/permissões de plugins externos (tratar em spec futura).
- Hot-reload de plugins (tratar em spec futura).

