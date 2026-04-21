# Spec 07 — Hook system (lifecycle events de plugins)

> Promove a proposta da Spec 5.2 a plano executável. Os hook points são o
> mecanismo que torna o registry da Spec 01 realmente **extensível**: em vez
> de empurrar patches para `orchestratorService`, plugins observam/mutam o
> fluxo nos pontos-chave.
>
> **Premissa:** nova versão do app — sem compat com o padrão atual de
> `streamBus` como único ponto de observação. `streamBus` continua sendo o
> canal de UI; hooks são o canal de **extensão**.

---

## Objetivo

Introduzir um pequeno conjunto de **hook points nomeados** que o orchestrator
dispara em momentos bem definidos do ciclo de vida de uma request. Plugins
registram handlers via `api.registerHook(name, handler)` e podem **observar**
(handler retorna `void`) ou **mutar/bloquear** (handler retorna um resultado
tipado por hook).

Alvos imediatos que deixam de ser hard-coded dentro de
`orchestratorService.ts` (1727 linhas):

- Redação de segredos em prompts outbound.
- Injeção de contexto de memória semântica antes do `chat()` (hoje embutido em
  `_runMaestroCore`).
- Transcrição de áudio → `memoryService` (hoje chamada direta).
- Aprovação de tool calls perigosas (Spec 5.1 HITL) — plugin de aprovação
  escuta `before_tool_call` e devolve `{ block: true, reason }` ou pede
  confirmação do usuário antes de liberar.

---

## Estado atual

- `electron/plugins/types.ts` já expõe `PluginApi` com
  `registerProvider`/`registerTool`/`unregisterTool` (L139–143). **Não** tem
  `registerHook`.
- `electron/plugins/registry.ts` resolve providers por `matches(model)` e tools
  por nome. **Não** tem tabela de hooks.
- `streamBus.ts` dispara eventos só para UI (thinking, texto, tool calls) — é
  **push-only, um-produtor**, não serve como bus de extensão.
- Pontos que hoje seriam "hooks implícitos" espalhados:
  - `orchestratorService.ts:845` — retry com model fallback.
  - `orchestratorService.ts:1315 / 1388 / 1516` — `synthesizeTaskResponse`.
  - `orchestratorService.ts:1712` — `provider.chat({...})` direto dentro do
    synthesize.
  - `memoryService` / `briefingEngine` / `proactivityEngine` chamam LLM sem
    nenhum observável programático.

---

## Inspiração no `oc/`

| Conceito | Arquivo |
|---|---|
| Lista canônica de hook names | `oc/src/plugins/hook-types.ts:55-84` (28 hooks) |
| Map `hookName → (event, ctx) => result` | `oc/src/plugins/hook-types.ts:574-691` |
| API pública `registerHook` | `oc/src/plugins/types.ts:1889-1893` / `registry.ts:224-270` |
| Hooks internos (dispatcher simples) | `oc/src/hooks/internal-hook-types.ts` (19 linhas — é literalmente um `(event) => Promise<void>`) |

O `oc` tem 28 hooks porque cobre gateway/canais/instalação/etc.; o `redbus`
não precisa disso. O conjunto redbus é um **subconjunto estrito** focado no
ciclo de um turno do agente.

---

## Contratos (plano de destino)

### Hook points — redbus v1

Oito pontos cobrem 100% dos casos listados em Spec 05 + Spec 5.1 + Spec 06:

| Hook | Quando dispara | Pode mutar? | Resultado tipado |
|---|---|---|---|
| `before_agent_start` | Entrada em `runAgentLoop` (nova request do user) | sim | `{ systemPromptPrepend?, abort?: {reason} }` |
| `before_prompt_build` | Antes de montar `messages[]` para `chat()` | sim | `{ extraMessages?: PluginMessage[] }` |
| `llm_input` | Depois da montagem final, antes do `provider.chat*()` | não | `void` |
| `llm_output` | Depois do `chat()`/`chatStream()` retornar | não | `void` |
| `before_tool_call` | Antes de `ToolPlugin.execute` | sim | `{ block?: boolean, reason?, paramsOverride? }` |
| `after_tool_call` | Depois de `ToolPlugin.execute` resolver/rejeitar | não | `void` |
| `before_message_write` | Antes de `memoryService.addMessageToChat`/variantes | sim | `{ contentOverride?: string }` |
| `agent_end` | Fim do turno (sucesso, erro ou abort) | não | `void` |

**Fora de escopo v1** (podem virar specs futuras se necessário):
`before_model_resolve`, `before_compaction`, `session_start`/`session_end`,
`subagent_*` (Spec 06 entrega eventos próprios — integração fica em 06),
`gateway_*` (não existe gateway no redbus), `before_install`.

### Tipos a adicionar em `electron/plugins/types.ts`

```ts
export type HookName =
  | 'before_agent_start'
  | 'before_prompt_build'
  | 'llm_input'
  | 'llm_output'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'before_message_write'
  | 'agent_end';

export interface HookContext {
  db: any;
  requestId: string | null;
  chatId?: string;
  role?: import('./roles').RoleName;   // Spec 06
}

export interface HookEventMap {
  before_agent_start: { userMessage: string };
  before_prompt_build: { systemPrompt: string; messages: PluginMessage[] };
  llm_input:          { model: string; messages: PluginMessage[]; tools?: PluginToolSchema[] };
  llm_output:         { model: string; result: ChatResult; elapsedMs: number };
  before_tool_call:   { toolName: string; params: any; toolCallId: string | null };
  after_tool_call:    { toolName: string; params: any; result: any; error?: unknown };
  before_message_write: { role: PluginMessageRole; content: string; chatId: string };
  agent_end:          { status: 'ok'|'error'|'aborted'; error?: unknown };
}

export interface HookResultMap {
  before_agent_start:  { systemPromptPrepend?: string; abort?: { reason: string } };
  before_prompt_build: { extraMessages?: PluginMessage[] };
  llm_input:           void;
  llm_output:          void;
  before_tool_call:    { block?: boolean; reason?: string; paramsOverride?: any };
  after_tool_call:     void;
  before_message_write:{ contentOverride?: string };
  agent_end:           void;
}

export type HookHandler<K extends HookName> = (
  event: HookEventMap[K],
  ctx: HookContext,
) => Promise<HookResultMap[K] | void> | HookResultMap[K] | void;

export interface PluginApi {
  registerProvider(plugin: ProviderPlugin): void;
  registerTool(plugin: ToolPlugin): void;
  unregisterTool(name: string): void;
  registerHook<K extends HookName>(
    name: K,
    handler: HookHandler<K>,
    opts?: { order?: number; pluginId?: string },
  ): void;
}
```

### Dispatcher (em `electron/plugins/registry.ts`)

```ts
export async function runHook<K extends HookName>(
  name: K,
  event: HookEventMap[K],
  ctx: HookContext,
): Promise<HookResultMap[K] | undefined> {
  const handlers = hookTable.get(name) ?? []; // já ordenados por `order`
  let acc: any = undefined;
  for (const h of handlers) {
    try {
      const res = await h(event, ctx);
      if (res) acc = mergeHookResult(name, acc, res);
      // short-circuit: blocks/aborts param o loop
      if (name === 'before_tool_call' && acc?.block) break;
      if (name === 'before_agent_start' && acc?.abort) break;
    } catch (err) {
      console.error(`[hook ${name}] handler failed`, err);
      // política v1: erro em hook **não** derruba a request; log e segue.
    }
  }
  return acc;
}
```

**Regras de merge (determinístico, cache-friendly):**
- `systemPromptPrepend`/`contentOverride`: concatena em ordem.
- `extraMessages`: `push`, preservando ordem de registro.
- `paramsOverride`: **last-write-wins** (último plugin ganha); documentado.
- `block`/`abort`: **first-wins**; loop encerra.
- Ordenação estável: primeiro `order` (ascendente, default `0`), depois ordem
  de registro (inserção). Crítico para prompt cache.

---

## Plano em 5 fases

### Fase 1 — Contrato e dispatcher (zero call sites novos)

1. Adicionar os tipos acima em `electron/plugins/types.ts`.
2. Criar `electron/plugins/hook-dispatcher.ts` com `runHook` + tabela interna
   `Map<HookName, HookHandler<any>[]>` + `mergeHookResult`.
3. Estender `createPluginApi` em `registry.ts` com `registerHook`.
4. **Critério:** `pnpm tsc --noEmit` verde; nenhum comportamento novo (nenhum
   `runHook(...)` ainda chamado).

### Fase 2 — Fiar hooks no hot-path do orchestrator

Tocar **apenas** `orchestratorService.ts` + `runAgentLoop` (após Spec 06):

| Local | Hook |
|---|---|
| início de `_runMaestroCore` | `before_agent_start` |
| logo antes do `chat()` L1712 e equivalentes | `before_prompt_build` → `llm_input` |
| logo depois do `await provider.chat(...)` | `llm_output` |
| antes de `tool.execute(...)` | `before_tool_call` (short-circuit se `block`) |
| depois de `tool.execute(...)` (finally) | `after_tool_call` |
| fim do turno (ambos os paths de retorno/erro) | `agent_end` |

`before_message_write` fica para Fase 3 (toca `memoryService`).

**Critério:** com zero hooks registrados, comportamento é idêntico ao atual
(testar com Claude maestro + uma skill trivial).

### Fase 3 — `before_message_write` em `memoryService`

1. `memoryService.addMessageToChat` (e variantes) passa a chamar
   `runHook('before_message_write', …)` antes do INSERT.
2. Se algum handler retorna `contentOverride`, o DB grava esse valor.
3. Caso de uso imediato: plugin built-in **`secret-redactor`** que varre
   `sk-...`, `AIza...`, tokens Bearer do conteúdo.

### Fase 4 — Plugin built-in: `memory-injector`

Hoje `orchestratorService._runMaestroCore` busca memória semântica e concatena
em `systemPrompt` manualmente. Refatorar:

1. Extrair a lógica para um plugin `electron/plugins/builtin/memory-injector.ts`.
2. Plugin registra `before_prompt_build` e injeta as memórias como
   `extraMessages` ou extende o system prompt (preservar byte-a-byte a ordem
   que o maestro hoje usa — senão fura prompt cache).
3. Remover a chamada direta do orchestrator.

**Critério:** diff do systemPrompt final com/sem plugin registrado é `∅`.

### Fase 5 — Integração com HITL (Spec 5.1) e Subagents (Spec 06)

- HITL vira **plugin** que registra `before_tool_call`. Nenhum código novo no
  orchestrator: o plugin decide se pausa e emite evento no `streamBus` para
  o renderer mostrar modal. Quando o user aprova, plugin devolve
  `{ paramsOverride: params }`; quando nega, `{ block: true, reason }`.
- Subagents (Spec 06): `spawn_subagent` pode emitir os mesmos hooks num
  contexto filho — mesmo dispatcher, `HookContext.role` carrega o role do
  subagent. Decisão: tabela global compartilhada em v1 (plugins veem todos os
  contextos); isolamento por depth fica para spec futura se necessário.

---

## Critérios de sucesso

- [ ] `electron/plugins/types.ts` exporta `HookName`, `HookEventMap`,
      `HookResultMap`, `HookHandler`, `PluginApi.registerHook`.
- [ ] `electron/plugins/hook-dispatcher.ts` tem `runHook` + merge determinístico
      + ordenação estável.
- [ ] Com zero plugins de hook registrados, uma request maestro → skill →
      synthesis produz bytes idênticos aos da versão pré-Spec-07 (prompt cache
      intacto).
- [ ] Plugin `secret-redactor` (built-in) remove chaves do conteúdo persistido.
- [ ] Plugin `memory-injector` (built-in) assume a injeção de memória semântica
      e `_runMaestroCore` não referencia mais `memoryService.*` diretamente
      para esse caso.
- [ ] HITL (quando aterrissar) usa **apenas** `registerHook('before_tool_call')`
      — nenhum `if (tool.dangerous)` no orchestrator.

## Fora de escopo

- Hooks de canal/gateway (`oc` os usa para Discord/Telegram/etc.; redbus é
  single-channel desktop).
- `before_compaction`/`after_compaction` — redbus não tem compaction de
  histórico hoje; se virar necessário, spec própria.
- Prioridade numérica cross-plugin (além de `order`): v1 fica com `order` +
  ordem de registro; `@priority('high')` decorator sugar fica para depois.
- Hooks assíncronos "detached" (fire-and-forget): tudo é `await` em v1 —
  previsibilidade > perf marginal.

## Ordem sugerida de execução

Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5.

Fases 1–3 podem ser feitas sem depender das outras specs. Fase 4 assume
Spec 04 (memoryService já acessível via registry). Fase 5 depende de Spec 5.1
(HITL) e Spec 06 (subagents) estarem em curso.

## Dependências

- **Pré-requisito:** Spec 01 (plugin registry existe e expõe `PluginApi`).
- **Habilita:** Spec 5.1 HITL (passa a ser um plugin, não um ramo do
  orchestrator).
- **Casa com:** Spec 06 — `HookContext.role` e `HookContext.requestId`
  cobrem o cenário subagent sem hooks novos.
- **Independente de:** Spec 02 (Skills) e Spec 03 (thinking) — hooks não
  atravessam essas superfícies em v1.


