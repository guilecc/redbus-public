# Spec 04 — Consumidores residuais do registry de plugins

## Objetivo

Fechar a migração iniciada na [Spec 01](./01-providers-e-tooling.md) eliminando
os últimos call sites que ainda conversam com APIs de LLM por `fetchWithTimeout`
/ `callOllamaChat` e contêm `if (model.includes(...))` espalhados. Todo acesso
a LLM no app deve passar por `getProviderForModel(model).chat(...)`.

Ao final:

- `fetchWithTimeout` e `callOllamaChat` permanecem exportados apenas como
  utilidades de **HTTP genérico** (ex.: chamadas não-chat como transcrição de
  áudio no OpenAI Whisper). Nenhum `if (model.startsWith('ollama/'))` em
  qualquer service.
- Cada service passa a ter ~1 chamada `provider.chat(...)` em vez de 4–5
  branches hardcoded.
- Streaming (maestro) é feito via um hook novo `provider.chatStream` registrado
  por provider, mantendo o comportamento atual de emissão de eventos no
  `streamBus`.

## Estado atual (pós-Spec 01)

O registry já existe e `llmService` / `providerService` já são finos. Mas
cinco consumidores ainda duplicam a lógica antiga:

| Arquivo | Linhas | O que ainda faz |
|---|---|---|
| `electron/services/orchestratorService.ts` | ~2007 | **Maestro** — chama Ollama/Gemini/Claude/GPT com `if (maestroModel...)` em 3 lugares: `_runMaestroCore` (L666–776, streaming), bloco de override (L915–934), e `_synthesizeWithStreaming` / `synthesizeTaskResponse` (L1778–1895). |
| `electron/services/memoryService.ts` | 298 | `callWorkerLLM` (L83–140) replica os 4 branches por provider para compaction/summarization. |
| `electron/services/briefingEngine.ts` | 321 | `callLLM` interno (L72–140) — 4 branches para gerar o briefing matinal. |
| `electron/services/proactivityEngine.ts` | 432 | Loop subconsciente (L214–250) — 4 branches para a análise reativa. |
| `electron/services/audioAdapterService.ts` | 235 | Duas rotinas: transcrição (Whisper, L58–106 — **HTTP genérico**, não é chat) e análise pós-transcrição (L164–185 — 3 branches). |

Total aproximado: **~180 linhas de branches duplicados** que somem após a
migração.

## Padrão de inspiração (já implementado)

O contrato foi definido na Spec 01 e vive em `electron/plugins/types.ts`:

```ts
export interface ProviderPlugin {
  id: string;
  label: string;
  matches: (model: string) => boolean;
  listModels: (apiKey: string, customUrl?: string) => Promise<ModelOption[]>;
  chat: (opts: ChatOptions) => Promise<ChatResult>;
}
```

Esta spec **estende** o contrato com um método opcional de streaming e um
helper de conveniência, sem quebrar as implementações atuais.

## Plano de migração

### Fase 1 — Estender `ProviderPlugin` com streaming

Adicionar ao `electron/plugins/types.ts`:

```ts
export interface ChatStreamCallbacks {
  onThinkingChunk?: (text: string) => void;
  onTextChunk?: (text: string) => void;
}

export interface ProviderPlugin {
  // ...existente
  /**
   * Opcional — quando presente, o core usa streaming e invoca os callbacks
   * conforme o provider emite chunks. Retorno: texto acumulado final.
   */
  chatStream?: (opts: ChatOptions, cb: ChatStreamCallbacks) => Promise<string>;
}
```

Implementar `chatStream` nos 4 providers reutilizando:

- `parseClaudeStream` para Anthropic (já lida com `thinking_delta` +
  `text_delta`).
- `parseOllamaStream` para Ollama (já detecta `<think>` e `reasoning_content`).
- Streaming SSE manual para OpenAI e Google (código já existe em
  `orchestratorService._synthesizeWithStreaming`, L1778–1827 — migrar para
  dentro dos plugins).

Criar um helper único `chatWithStream(model, opts, requestId)` em
`electron/plugins/index.ts` que:

1. Resolve o provider via `getProviderForModel`.
2. Se o plugin tem `chatStream`, chama com callbacks que emitem
   `emitThinkingChunk` / `emitResponseChunk` no `streamBus`.
3. Caso contrário, faz fallback para `.chat(...)` e emite um único
   `response-chunk` no final.

### Fase 2 — Migrar consumidores simples (não-streaming)

Nesta ordem (de mais baixo risco para mais alto):

1. **`memoryService.callWorkerLLM`** → substituir corpo inteiro por:

   ```ts
   const provider = getProviderForModel(model);
   const r = await provider.chat({
     model, configs,
     systemPrompt, messages: [{ role: 'user', content: userPrompt }],
     maxTokens: 2048,
   });
   return (r.content || '').trim();
   ```

   Redução: 57 → ~8 linhas.

2. **`briefingEngine` callLLM** — idem, com `responseFormat: 'json_object'`
   quando aplicável. Redução: ~70 → ~10 linhas.

3. **`proactivityEngine`** — idem. Redução: ~40 → ~8 linhas.

4. **`audioAdapterService`** parte de análise (L164–185): idem. A parte de
   transcrição Whisper (L58–106) **fica como está** — não é chat, é upload
   multipart para `/v1/audio/transcriptions`. A `fetchWithTimeout` continua
   válida aí.

### Fase 3 — Migrar o maestro (streaming)

`orchestratorService` é o caso mais intrusivo. Três blocos a migrar:

1. **`_runMaestroCore` (L660–776)** — call principal com streaming de
   thinking+texto. Substituir por:

   ```ts
   const provider = getProviderForModel(maestroModel);
   rawResponse = await chatWithStream(maestroModel, {
     model: maestroModel, configs,
     systemPrompt,
     messages: [{ role: 'user', content: userPromptText }],
     responseFormat: 'json_object',
     maxTokens: 16384,
   }, _currentRequestId);
   // strip dos ```…``` fica aqui, é pós-processamento agnóstico de provider.
   ```

   O detalhe do `thinking: { type: 'enabled', budget_tokens: 8192 }` do Claude
   fica no plugin Anthropic, condicional a um flag `reasoning?: boolean` em
   `ChatOptions` (ponte com a [Spec 03](./03-thinking-e-reasoning.md)).

2. **Bloco de override (L915–934)** — usa `temperature: 0.2` e não pede JSON.
   Adicionar `temperature?: number` em `ChatOptions` e delegar.

3. **`_synthesizeWithStreaming` (L1765–1895)** — segue o mesmo padrão do
   item 1, mas usa `workerModel` em vez de `maestroModel`.

Ao final, `orchestratorService` não deve mais importar `fetchWithTimeout`
nem `callOllamaChat`. Os imports de `parseClaudeStream` / `parseOllamaStream`
viram internos dos plugins.

### Fase 4 — Limpeza

- Remover os re-exports `fetchWithTimeout` e `callOllamaChat` de
  `electron/services/llmService.ts` (continuam disponíveis via
  `electron/plugins/http` e `electron/plugins/providers/ollama` para os
  poucos lugares não-chat que ainda usam — ex.: `audioAdapterService`
  Whisper).
- Apagar `electron/services/{ollama,claude}StreamParser.ts` da raiz de
  `services/` **ou** movê-los para `electron/plugins/providers/streams/`
  (decisão: mover, pois ficam coesos com os providers).

## Critérios de sucesso

- `grep -r "model.includes('claude')\|model.includes('gemini')\|model.includes('gpt')\|model.startsWith('ollama" electron/services/` retorna **zero** matches.
- `orchestratorService.ts` perde ~250 linhas (todos os 3 blocos de branch).
- `memoryService.callWorkerLLM`, `briefingEngine`, `proactivityEngine` e
  `audioAdapterService` (análise) ficam cada um com ≤10 linhas de lógica
  de LLM.
- Testes existentes (`briefingEngine.test.ts`, `audioAdapter.test.ts`,
  `channelManager.test.ts`) continuam passando sem alteração — os mocks
  de `fetchWithTimeout` passam a atingir o plugin, mas a URL final é a
  mesma, então os `expect` continuam válidos.
- Novo teste `test/orchestratorMaestroStream.test.ts` com mock de
  `chatStream` validando que o maestro emite `thinking-start` /
  `thinking-chunk` / `response-chunk` no `streamBus`.

## Fora de escopo desta spec

- Alterar formato de prompt do maestro (assunto da
  [Spec 02](./02-forge-e-skills.md)).
- Unificar o modelo de reasoning (assunto da
  [Spec 03](./03-thinking-e-reasoning.md)) — esta spec apenas deixa o gancho
  `reasoning?: boolean` em `ChatOptions` pronto para a 03 preencher.
- Deprecação de `ProviderConfigs` (keys ainda vêm daí).

## Ordem sugerida de execução

1. Fase 1 (estender contrato + `chatStream` em 4 plugins) — ~1 PR.
2. Fase 2 (4 services simples) — pode ser 1 PR por service ou 1 único.
3. Fase 3 (maestro) — 1 PR isolado, inclui teste novo.
4. Fase 4 (limpeza) — 1 PR pequeno.

