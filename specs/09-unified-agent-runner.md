# Spec 09 — Unified Agent Runner (substituto do `workerLoop`)

> **Pergunta de partida:** hoje o `redbus` tem o `workerLoop.ts` executando
> tarefas em estilo ReAct. O `oc` faz isso de um jeito bem diferente. Esta
> spec mapeia o padrão do `oc/src/agents/pi-embedded-runner/` contra o
> estado atual e propõe um runner único para o `redbus`.
>
> A Spec 06 já enunciou "unificar `workerLoop` + `intelligentExtractor` num
> único `runAgentLoop`". Aqui o plano vira **executável**, com superfícies
> nomeadas e um subset viável dos módulos que o `oc` expõe.

---

## Objetivo

1. Um único motor de execução (`runAgent(...)`) que substitui os dois
   entrypoints do `workerLoop.ts` (`executeWorkerOnView`, `executeSkillTask`)
   e o loop duplicado dentro de `intelligentExtractor.ts`.
2. Separar **Run** (pedido lógico) de **Attempt** (tentativa de chamada
   LLM): a ordem dos loops passa a ser "Run → (várias) Attempts → (várias
   turns por attempt)", não o loop único e chato de hoje.
3. **Abort como cidadão de primeira classe** — `AbortSignal` propaga do IPC
   até a cada `await`, eliminando o hack atual de "pede consent quando estourar
   25 passos".
4. **Registry global de runs ativos** com `abort`, `queueMessage`, `isActive`,
   `waitForEnd` — permite que a UI pause, injete mensagem no meio ou cancele
   sem pular pelo DB.
5. **Resultado rico e tipado**: `AgentRunResult` com `meta.{durationMs, usage,
   aborted, stopReason, pendingToolCalls, toolSummary, error}`, suficiente
   para a UI exibir status sem heurística em cima de string.
6. Tool execution via registry (Spec 01) — fim do `switch (toolCall.name)` no
   meio do loop. HITL e browser tools deixam de ser especiais e viram
   plugins que registram tools + hooks (Spec 07).

---

## Estado atual

| Peça | Onde está | Problema |
|---|---|---|
| Loop principal | `electron/services/workerLoop.ts:235-315` (`_runLoop`) | 317 LOC; 1 arquivo, tudo inline. |
| Entradas | `executeWorkerOnView` (L143), `executeSkillTask` (L181) | Duas funções construindo mensagens à mão, com system-prompt divergente. |
| Loop duplicado | `electron/services/intelligentExtractor.ts:128-159` | Copia o mesmo padrão com outro system-prompt. |
| Tool dispatch | switch inline em `_execBrowserTool` (L34) + `_execGenericTool` (L80) | Hardcoded por nome de tool. |
| HITL | `_handleConsent` (L110) + `consentResolvers` map | Global mutável; acoplado a `mainWindow`; vaza 120s se IPC morrer. |
| Step limit | Dialog de consent no final (L289-307) | Pede autorização do usuário pra "continuar mais 25" quando na verdade o app deveria dar abort e expor loop detection. |
| Abort | — | **Inexistente**. Usuário não consegue cancelar uma execução. |
| Resultado | `any` (`finalData` em L237) | Sem contrato, sem usage, sem stop reason. |
| Concorrência | — | Nada impede `executeSkillTask` e `executeWorkerOnView` rodarem no mesmo session_id simultaneamente. |
| LLM call | `runWorkerStep(db, messages)` (llmService.ts:71) | Sempre role `executor`; sem fallback de provider, sem retry policy. |

---

## Como o `oc` faz (`oc/src/agents/pi-embedded-runner/`)

O entrypoint é `runEmbeddedPiAgent(params)` em `run.ts:200` (arquivo de 2081
linhas). **Não** é 1 arquivo — é um cluster. As peças que importam:

| Conceito | Arquivo | Função que cumpre |
|---|---|---|
| Entry + retry loop | `run.ts` | Orquestra múltiplas `Attempt`s até ter resultado. |
| Attempt (1 request LLM + turns de tool) | `run/attempt.ts` (2618 LOC) | Executa uma tentativa completa com 1 par provider/model/authProfile. |
| Registry global de runs | `runs.ts:53-74` (`activeRuns`, `snapshots`, `waiters`, `modelSwitchRequests`) | `queueEmbeddedPiMessage`, `abortEmbeddedPiRun`, `isEmbeddedPiRunActive`, `waitForEmbeddedPiRunEnd`. |
| Lane (serialização) | `run/lanes.ts` + `process/command-queue.ts` | `sessionLane` (impede duas runs no mesmo chat) + `globalLane`. |
| Abort propagação | `run.ts:230` (`throwIfAborted`) | Checado antes de cada `await`, nome `AbortError`. |
| Rich result | `pi-embedded-runner/types.ts:97-154` (`EmbeddedPiRunMeta`, `EmbeddedPiRunResult`) | Traça `executionTrace.attempts[]`, `toolSummary`, `contextManagement`, `error.kind`. |
| Tool normalização | `run/attempt.tool-call-normalization.ts` (947 LOC) + `attempt.tool-call-argument-repair.ts` | Conserta JSON quebrado e alinha shape entre providers. |
| Loop detection | `agents/tool-loop-detection.ts` | Detecta mesma tool repetida → força stop, não pede "continua?". |
| Failover de provider | `run/failover-policy.ts` + `run/assistant-failover.ts` | Decide retry, rotação de auth profile, fallback de modelo. |
| Context engine | `context-engine/` + `run.ts:5` (`resolveContextEngine`) | Ingest/assemble/compact como seam; history, truncation, image-prune. |
| Hooks | `plugins/hook-runner-global.ts` + `run/setup.ts` (`resolveHookModelSelection`) | `before_agent_start` chega a **trocar provider/modelo** antes do call. |
| Result assembly | `run/payloads.ts` | Converte transcript final em payloads para o channel. |

Pontos que o `oc` faz e o `workerLoop` não:

1. **Run registry global** — a UI aborta via `abortEmbeddedPiRun(sessionId)`.
2. **Abort é `AbortSignal` padrão** — não um flag, não timeout interno.
3. **Lane** — duas mensagens seguidas no mesmo chat enfileiram, não colidem.
4. **Attempt ≠ Run** — retry de provider/modelo/auth-profile **fora** do loop de turns.
5. **Resultado tipado e observável** — `executionTrace.attempts[]` permite UI de debug.
6. **Tool call argument repair** — LLM retorna JSON inválido → normaliza e tenta, não quebra.
7. **Loop detection** — agente chama a mesma tool 5× com args idênticos → abort automático.
8. **Hook `before_agent_start`** decide `{provider, model}` — reroute sem tocar no runner.

**O que o `oc` faz que a gente NÃO vai copiar (overkill):**

- 40 submódulos (`auth-controller`, `compaction-retry-aggregate-timeout`,
  `preemptive-compaction`, `llm-idle-timeout`, `incomplete-turn`, etc.).
- Compaction automática com diagId, preflight, retries de compaction. O
  redbus já tem compaction rolando via `archiveService`; integra como hook
  depois.
- Auth profile rotation multi-cloud.
- Context engine pluggable em V1 — começamos com 1 engine embutido.
- `EmbeddedRunModelSwitchRequest` — trocar modelo no meio da run.


---

## Contratos (plano de destino)

### 1. Entry único

`electron/services/agentRunner.ts` (novo, ~400 LOC projetados):

```ts
export interface AgentRunParams {
  runId: string;                          // uuid
  sessionId: string;                      // lane key
  role: RoleName;                         // qual role LLM usar (Spec 06)
  prompt: AgentPrompt;                    // system + user + history
  tools?: string[];                       // allowlist de tool names (default: todos do registry)
  maxSteps?: number;                      // default 25 (hoje hardcoded)
  abortSignal?: AbortSignal;
  hooks?: HookContextOverrides;           // override por-run (channel, trigger, etc.)

  // modos (substitui os 3 entrypoints atuais)
  mode:
    | { kind: 'chat' }                              // maestro/general
    | { kind: 'browser'; browserSessionId: string } // hoje executeWorkerOnView
    | { kind: 'skill';   skillName?: string }       // hoje executeSkillTask
    | { kind: 'extract'; channelId: ChannelId; url: string; targetDate?: string }; // hoje intelligentExtract
}

export interface AgentRunResult {
  payloads: AgentPayload[];              // 1+ respostas finais (msg, media, etc.)
  committedData?: unknown;               // retorno de commit_extracted_data
  meta: {
    durationMs: number;
    usage?: NormalizedUsage;
    aborted: boolean;
    stopReason: 'committed' | 'text_final' | 'aborted' | 'max_steps' | 'loop_detected' | 'tool_error' | 'llm_error';
    pendingToolCalls?: Array<{ id: string; name: string; args: unknown }>;
    toolSummary: { calls: number; tools: string[]; failures: number; totalMs: number };
    executionTrace: AttemptTrace[];
    error?: { kind: string; message: string };
  };
}

export async function runAgent(db: DB, params: AgentRunParams): Promise<AgentRunResult>;
```

Os 3 entrypoints atuais viram finos adaptadores que chamam `runAgent`:

- `executeWorkerOnView(db, sessionId, instr, win)` → `runAgent({ mode:{kind:'browser', browserSessionId: sessionId}, ... })`.
- `executeSkillTask(db, {task, skillName}, win)` → `runAgent({ mode:{kind:'skill', skillName}, ... })`.
- `intelligentExtract(db, channelId, url, date)` → `runAgent({ mode:{kind:'extract', channelId, url, targetDate: date}, ... })`.

Depois de estabilizado, as callers migram direto para `runAgent` e os
adaptadores somem.

### 2. Registry de runs ativos

`electron/services/runRegistry.ts` (novo):

```ts
interface RunHandle {
  runId: string;
  sessionId: string;
  abortController: AbortController;
  queueMessage(text: string): boolean;   // injeta user message na próxima turn
  isStreaming(): boolean;
  waitForEnd(timeoutMs?: number): Promise<boolean>;
}

export function getActiveRun(sessionId: string): RunHandle | undefined;
export function abortRun(sessionId: string, reason?: 'user' | 'superseded' | 'timeout'): boolean;
export function listActiveRuns(): RunHandle[];
```

Espelha `oc/src/agents/pi-embedded-runner/runs.ts:53-74` com um subset.
**Não** usamos `Symbol.for(...globalSingleton...)` — no electron/main não há
múltiplos bundles.

### 3. Lane (serialização)

`electron/services/runLanes.ts` (novo, ~40 LOC):

```ts
export function enqueueInLane<T>(laneKey: string, task: () => Promise<T>): Promise<T>;
```

Map de `Promise<unknown>` por lane; cada `enqueue` encadeia no `.then()` do
último. Sem `p-queue` — o caso de uso é serializar, não paralelizar.

### 4. Abort como primeira classe

- `AbortSignal` é param obrigatório do runner interno (o `AgentRunParams.abortSignal` pode ser omitido pelo caller; o runner cria um próprio e o expõe via `RunHandle`).
- `throwIfAborted(signal)` chamado antes de cada `await llm`, `await tool.execute`, `await snapshot`.
- Erro: `class RunAbortedError extends Error { name = 'AbortError' }`.
- `factory-reset` e desconexão de channel chamam `abortRun(sessionId, 'superseded')`.

### 5. Tool dispatch via registry

Hoje: `_execBrowserTool` + `_execGenericTool` + `_handleConsent` + `commit_extracted_data` todos inline. Novo:

```ts
const tool = getTool(toolCall.name);
if (!tool) return errorTurn(`Unknown tool: ${toolCall.name}`);
const result = await tool.execute(ctx, toolCall.args, { db, mode, skillName });
```

- Browser tools (`browser_snapshot`, `browser_click`, ...) passam a ser registradas por um **plugin** `browser-tools` que consome `browserSessionId` de `ctx.mode`.
- `commit_extracted_data` vira um **tool especial** que seta `ctx.commit(data)` e retorna stop — o runner lê `ctx.commit` pra fechar a run.
- `request_explicit_human_consent` vira um **plugin HITL** que registra a tool + hook `before_tool_call` (consistente com Spec 07).

### 6. Attempt vs Run

Dentro de `runAgent`:

```ts
async function runAgent(...): Promise<AgentRunResult> {
  return enqueueInLane(`session:${sessionId}`, async () => {
    const attempts: AttemptTrace[] = [];
    for (let attemptIdx = 0; attemptIdx < MAX_ATTEMPTS; attemptIdx++) {
      throwIfAborted(signal);
      const attempt = await runAttempt({ ...params, attemptIdx, signal });
      attempts.push(attempt.trace);
      if (attempt.done) return { ...attempt.result, meta: { ...attempt.meta, executionTrace: attempts }};
      if (!attempt.retryable) break;
      // policy: trocar role? esperar cooldown? reinvocar.
    }
    return errorResult(attempts, 'retry_limit');
  });
}
```

- **Attempt** = 1 loop de turns (ReAct) até `commit`, `text_final`, `max_steps`, `loop_detected` ou um erro.
- **Run** = possivelmente várias attempts (hoje sempre 1; a estrutura só importa quando entrar failover provider na Spec 01 completa).

### 7. Loop detection

Porta de `oc/src/agents/tool-loop-detection.ts` (arquivo pequeno) — detecta
`toolName + JSON.stringify(args)` repetido ≥ 3× consecutivo → stop com
`stopReason: 'loop_detected'`. Substitui o diálogo atual de "autorizar mais 25
passos", que só mascara loop infinito.

### 8. Hooks (ponte com Spec 07)

No início/fim de `runAttempt` e em volta de cada tool call:

| Momento | Hook point | Origem no `oc` |
|---|---|---|
| Antes de resolver role/modelo | `before_agent_start` | `run/setup.ts:resolveHookModelSelection` |
| Antes de compor o prompt | `before_prompt_build` | (analogia com payload build) |
| Depois do prompt pronto, antes do provider call | `llm_input` | `payloads.ts` |
| Depois da resposta LLM | `llm_output` | `run.ts` pós-call |
| Antes de despachar tool | `before_tool_call` | onde o HITL plugin engancha |
| Depois do tool result | `after_tool_call` | redator de logs / truncador |
| Antes de persistir mensagem | `before_message_write` | `orchestratorService` hoje |
| Fim do turno | `agent_end` | `runs.ts` cleanup |

HITL (`request_explicit_human_consent`) vira um plugin — consome `before_tool_call` pra decidir se pede confirmação, usa a tool em si como canal de renderização. O map `consentResolvers` atual some do `workerLoop`.

### 9. IPC surface afetada

- `ipcMain.handle('runAgent:abort', (_, sessionId) => abortRun(sessionId, 'user'))` — novo.
- `ipcMain.handle('runAgent:queue-message', (_, sessionId, text) => ...)` — opcional, para "type while thinking".
- `ipcMain.handle('runAgent:active', () => listActiveRuns().map(r => ({runId, sessionId})))` — debug/UI.
- `hitl-consent-response` atual continua, mas handler vira parte do plugin HITL (Spec 07/5.1).

---

## Plano em 5 fases

### Fase 1 — Extrair `runAttempt` + resultado tipado (sem quebrar APIs)

1. Criar `electron/services/agentRunner/` com:
   - `types.ts` (AgentRunParams, AgentRunResult, AttemptTrace).
   - `runAttempt.ts` extraindo `_runLoop` atual para função que recebe `AbortSignal` e retorna `AttemptResult` tipado.
2. `workerLoop.ts:_runLoop` passa a delegar para `runAttempt` (adapter fino).
3. `intelligentExtractor.ts:128-159` também passa a chamar `runAttempt` com `mode:{kind:'extract'}`.
4. **Critério:** testes manuais do maestro e do worker continuam passando; `grep -c "while (isRunning" electron/services/` cai pra 0; resultado ainda casteado pra `any` nos callers, mas o **interno** do runner já é tipado.

### Fase 2 — Run registry + lane + abort IPC

1. `runRegistry.ts` + `runLanes.ts`.
2. `runAgent` (wrapper sobre `runAttempt`) enfileirando em `session:${sessionId}` e registrando handle.
3. IPC `runAgent:abort` + botão "Parar" em `src/components/Chat/*` chamando o novo IPC.
4. `throwIfAborted` em cada await dentro de `runAttempt`.
5. **Critério:** abrir 2 prompts no mesmo chat faz o 2º esperar o 1º terminar (ou cancelar se user apertar Parar). Botão Parar interrompe dentro de <1s mesmo no meio de `browser_snapshot`.

### Fase 3 — Tool dispatch via registry + loop detection

1. Registrar browser tools como plugin: `electron/plugins/builtins/browser-tools.ts` exporta 6 tools que consomem `ctx.mode.browserSessionId`.
2. `commit_extracted_data` vira tool padrão que seta um flag de término.
3. `request_explicit_human_consent` continua inline **temporariamente** até a Spec 07 landar — depois vira plugin.
4. Portar `tool-loop-detection.ts` (pequeno) para `electron/services/agentRunner/loopDetection.ts`.
5. **Critério:** zero `switch (toolCall.name)` em `agentRunner/`; `isDangerousCommand` (hoje inline no workerLoop L91) migra para dentro do plugin `exec`.

### Fase 4 — Substituir os 3 entrypoints pelas adapters

1. `executeWorkerOnView`, `executeSkillTask` e `intelligentExtract` viram funções finas de 5-10 LOC que constroem `AgentRunParams` e chamam `runAgent`.
2. Callers (`ipcHandlers.ts:284/300/358`, extractors) passam a usar o resultado tipado (`AgentRunResult`) em vez de `any`.
3. Mensagens de `logActivity('orchestrator', ...)` passam a ler de `meta.executionTrace`/`meta.toolSummary` em vez de `console.log` avulsos — centralizadas num único `logRunMeta(meta)`.
4. **Critério:** `workerLoop.ts` fica < 50 LOC (só adapters); `intelligentExtractor.ts` fica < 50 LOC.

### Fase 5 — Integração com hooks (depende da Spec 07 landar)

1. Chamar `hookRunner.runBeforeAgentStart(ctx)` no topo de `runAttempt`.
2. Injetar `before_tool_call` / `after_tool_call` em volta de `tool.execute`.
3. Mover HITL para plugin (`electron/plugins/builtins/hitl.ts`) — `_handleConsent` sai do runner.
4. `agent_end` hook pra plugins de telemetria/memória.
5. **Critério:** `grep -r "consentResolvers\|_handleConsent" electron/` retorna zero hits.

---

## Critérios de sucesso

- [ ] `workerLoop.ts` < 50 LOC (só adapters para `runAgent`).
- [ ] `intelligentExtractor.ts` < 50 LOC.
- [ ] Botão "Parar" na UI funciona em qualquer execução em <1s.
- [ ] Dois prompts seguidos no mesmo chat **serializam** — não colidem, não misturam respostas.
- [ ] `AgentRunResult.meta.stopReason` é um union fechado; nunca `undefined`.
- [ ] Loop infinito (tool mesma 5×) para com `stopReason: 'loop_detected'` — sem pedir consent.
- [ ] `grep -n "switch (toolCall.name)" electron/` retorna zero hits.
- [ ] Zero `any` no entry público `runAgent`.
- [ ] Resultado contém `executionTrace[]` útil pra UI de debug (mesmo que 1 attempt por enquanto).

## Fora de escopo

- **Compaction automática** dentro do runner — fica na Spec 5.5 / integra depois como context-engine seam.
- **Auth profile rotation** multi-cloud — entra com a Spec 01 completa.
- **Model switch mid-run** (`EmbeddedRunModelSwitchRequest`) — útil, mas não essencial pra V1.
- **Context engine pluggable** — V1 tem 1 engine embutido (prompt-build direto), registry vem depois.
- **Streaming de thinking tokens** fino — Spec 03 cobre o transporte; runner só repassa eventos.
- **Subagents / spawn** — Spec 06 trata; o `runAgent` só precisa ser reentrante (um agente chamar outro `runAgent` com `sessionId` diferente).

## Ordem sugerida de execução

Fase 1 (extrair runAttempt) → Fase 2 (registry/lane/abort) → Fase 3 (tool registry + loop detection) → Fase 4 (adapters finos) → Fase 5 (hooks).

Cada fase é shippable isolada: depois da Fase 2 já dá pra demo "botão Parar"; depois da Fase 3 já dá pra dizer que tool-calling é plugin-first.

## Dependências

- **Pré-requisito:** Spec 01 (registry de plugins / tools) — a Fase 3 depende de `getTool(name)` existir.
- **Pré-requisito fraco:** Spec 06 (roles) — `AgentRunParams.role` assume `RoleName` tipado. Se 06 não estiver pronto, usar string livre temporariamente.
- **Casa com:** Spec 07 (hooks) — Fase 5 consome os 8 hook points definidos lá.
- **Casa com:** Spec 02 (Skills) — `mode:{kind:'skill'}` depende de `readSkill` já existente (não muda).
- **Independente de:** Spec 03 (thinking), 04 (consumidores residuais), 08 (onboarding).
