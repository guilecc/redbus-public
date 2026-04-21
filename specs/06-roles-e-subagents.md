# Spec 06 — Roles nomeadas e subagents dinâmicos

## Objetivo

Generalizar o padrão **maestro/worker** que hoje vive como dois slots
hardcoded (`ProviderConfigs.maestroModel` + `ProviderConfigs.workerModel`)
para um sistema de **roles nomeadas** resolvíveis por config, e **opcionalmente**
habilitar que o próprio LLM decomponha problemas em **subagents** via tool
call — inspirado em `oc/src/agents/subagent-*` / `acp-spawn-*`.

Ao final:

- `ProviderConfigs` deixa de ter `maestroModel` / `workerModel` e passa a
  ter `roles: Record<RoleName, RoleBinding>`.
- Cada call site pede por **papel semântico** (`'planner'`,
  `'executor'`, `'synthesizer'`), não por nome de slot.
- `workerLoop.ts` e `intelligentExtractor.ts` — hoje duas implementações
  quase idênticas — convergem num único helper `runAgentLoop(...)`.
- Um `ToolPlugin` novo `spawn_subagent` permite ao planner delegar
  subtarefas em contexto isolado, com allowlist de tools e limite de
  profundidade (opt-in, não usado por default).
- Skills (Spec 02) declaram `role` e `allowlist` no frontmatter, e o
  orchestrator roteia a execução automaticamente.

## Estado atual (redbus)

**Schema** (`electron/database.ts:151–168`):

```sql
CREATE TABLE ProviderConfigs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  openAiKey TEXT, anthropicKey TEXT, googleKey TEXT,
  ollamaUrl TEXT, ollamaCloudKey TEXT, ollamaCloudUrl TEXT,
  maestroModel TEXT DEFAULT 'claude-3-7-sonnet-20250219',
  workerModel TEXT DEFAULT 'gemini-2.5-flash',
  updatedAt DATETIME
);
```

**Call sites que consultam `maestroModel`:**

| Arquivo | Linhas | Papel implícito |
|---|---|---|
| `orchestratorService._runMaestroCore` | L301, L696 | `planner` |
| `orchestratorService` retry (L845–846) | L845 | `planner` (mesmo) |

**Call sites que consultam `workerModel`:**

| Arquivo | Linhas | Papel real |
|---|---|---|
| `orchestratorService.synthesizeTaskResponse` | L1672, L1700, L1703, L1713 | `synthesizer` |
| `llmService.runWorkerStep` | L36, L71, L86 | `executor` (tool loop) |
| `workerLoop.executeWorkerOnView` | (via `runWorkerStep`) | `executor` (browser) |
| `intelligentExtractor` | (via `runWorkerStep`) | `executor` (extração) |
| `memoryService.callWorkerLLM` | L86 | `utility` (compactação) |
| `briefingEngine.callLLM` | L69 | `utility` (briefing JSON) |
| `proactivityEngine` | L288, L383 | `utility` (análise reativa) |
| `audioAdapterService.analyze` | L160, L200 | `utility` (pós-transcrição) |

Ou seja, `workerModel` é usado para **três papéis distintos** (executor,
synthesizer, utility) que hoje compartilham o mesmo slot por acidente.

**Duplicação detectada:** `workerLoop.ts` (L1–260) e
`intelligentExtractor.ts` implementam o **mesmo** laço
`snapshot → decide → act → snapshot`, a diferença é só o set de tools.
Ambos chamam `runWorkerStep(db, messages)` em loop.

## Padrão de inspiração (`oc`)

O `oc` não tem slots fixos. Tem **um agente principal** que pode **spawnar
subagents em runtime** via tool call. Metadata canônica:

```ts
// oc/src/agents/spawned-context.ts
export type SpawnedRunMetadata = {
  parentSessionId: string;
  depth: number;
  allowlist?: string[];
  model?: string;
  thinkingLevel?: ThinkLevel;
};
```

Guardrails relevantes:

- `openclaw-tools.subagents.sessions-spawn-depth-limits.test.ts` — profundidade.
- `openclaw-tools.subagents.sessions-spawn.allowlist.test.ts` — pai controla tools do filho.
- `openclaw-tools.subagents.sessions-spawn.model.test.ts` — modelo por spawn.
- `openclaw-tools.subagents.sessions-spawn-applies-thinking-default.test.ts` — thinking por spawn.

**Não copiamos tudo.** Redbus é single-user desktop, não precisa de árvore
profunda de agentes, `parentSessionId`, `announce queue` etc. Pegamos a
ideia, encolhemos o escopo.

## Contratos

### Novo schema `ProviderConfigs`

```sql
CREATE TABLE ProviderConfigs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- keys (inalterado)
  openAiKey TEXT, anthropicKey TEXT, googleKey TEXT,
  ollamaUrl TEXT, ollamaCloudKey TEXT, ollamaCloudUrl TEXT,
  -- JSON único: Record<RoleName, RoleBinding>
  roles TEXT NOT NULL DEFAULT '{"planner":{"model":"claude-3-7-sonnet-20250219","thinkingLevel":"medium"},"executor":{"model":"gemini-2.5-flash","thinkingLevel":"off"},"synthesizer":{"model":"gemini-2.5-flash","thinkingLevel":"off"},"utility":{"model":"gemini-2.5-flash","thinkingLevel":"off"}}',
  updatedAt DATETIME
);
```

Colunas `maestroModel` / `workerModel` **removidas** (premissa do projeto:
versão nova, sem migração de dados — ver `specs/README.md`).

### Role resolver

Novo arquivo `electron/services/roles.ts`:

```ts
export type RoleName = 'planner' | 'executor' | 'synthesizer' | 'utility';

export interface RoleBinding {
  model: string;
  thinkingLevel?: ThinkLevel;
  /** Opcional override por-role do temperature. */
  temperature?: number;
}

export function resolveRole(db: any, role: RoleName): RoleBinding;
/** Helper que já devolve `{ provider, model, thinkingLevel, ... }`. */
export function chatWithRole(
  db: any,
  role: RoleName,
  opts: Omit<ChatOptions, 'model' | 'thinkingLevel'>
): Promise<ChatResult>;
```

Todos os call sites passam a chamar:

```ts
// antes:
const workerModel = configs.workerModel || 'gemini-2.5-flash';
const provider = getProviderForModel(workerModel);
await provider.chat({ model: workerModel, ... });

// depois:
await chatWithRole(db, 'utility', { systemPrompt, messages, ... });
```

### Loop unificado

Novo `electron/services/agentLoop.ts` substituindo a lógica comum de
`workerLoop.ts` e `intelligentExtractor.ts`:

```ts
export interface AgentLoopOptions {
  role: RoleName;                      // default 'executor'
  systemPrompt: string;
  instruction: string;
  toolAllowlist?: string[];            // nomes de ToolPlugin
  maxSteps?: number;                   // default 20
  /** Parent loop, se subagent. Usado pra propagar HITL/streaming. */
  parent?: { depth: number; requestId?: string };
  /** Callback chamado com o resultado de cada step — pra logging/UI. */
  onStep?: (step: AgentLoopStep) => void;
}

export async function runAgentLoop(
  db: any,
  opts: AgentLoopOptions,
): Promise<{ output: string; steps: AgentLoopStep[] }>;
```

`workerLoop.executeWorkerOnView` e `intelligentExtractor` viram thin
wrappers que só configuram `toolAllowlist` e `systemPrompt`.

### Tool `spawn_subagent` (opcional, planner→executor)

Novo `ToolPlugin` registrado por default:

```ts
{
  name: 'spawn_subagent',
  description: 'Delegate an isolated subtask to a worker with limited tools.',
  parameters: {
    type: 'object',
    required: ['instruction'],
    properties: {
      instruction: { type: 'string', description: 'What the subagent should accomplish.' },
      role: { type: 'string', enum: ['executor', 'utility'], default: 'executor' },
      tools: { type: 'array', items: { type: 'string' }, description: 'Tool names the subagent may call.' },
    },
  },
  execute: async (_id, params, ctx) => {
    const parentDepth = ctx.agentDepth ?? 0;
    if (parentDepth >= MAX_SUBAGENT_DEPTH) {
      return { error: 'max subagent depth reached' };
    }
    const { output } = await runAgentLoop(ctx.db, {
      role: params.role ?? 'executor',
      instruction: params.instruction,
      toolAllowlist: params.tools,
      systemPrompt: DEFAULT_SUBAGENT_SYSTEM,
      parent: { depth: parentDepth + 1, requestId: ctx.requestId },
    });
    return { output };
  },
}
```

Constantes: `MAX_SUBAGENT_DEPTH = 2` (um planner → um executor → fim).
Redbus não justifica mais profundidade.

### Skills declaram role (ponte com Spec 02)

```yaml
---
name: extract_calendar_events
role: executor
allowlist: [calendar_read, calendar_search]
thinking: minimal
---
```

O `skillsLoader` passa a ler esses campos e, ao invocar uma skill, usa
`runAgentLoop({ role, toolAllowlist: allowlist, ... })` em vez de rodar
no contexto do planner.

## UI de Settings — seleção de LLM por role

### Estado atual

- `src/App.tsx:42` — state `{ maestroModel, workerModel }`.
- `src/App.tsx:426–434` — `handleChangeModel(type: 'maestroModel' |
  'workerModel', value)`.
- `src/App.tsx:163` — IPC `saveProviderConfigs` / `getProviderConfigs` lê
  e escreve `maestroModel` + `workerModel` diretos.
- `src/components/Settings/OllamaSettings.tsx` — lista curada de modelos
  locais com `role: 'worker' | 'maestro'` (L24–56) como dica visual, e
  dois botões por modelo ("Usar como maestro" / "Usar como worker",
  L179/L186).
- `ThinkingLevelPicker` hoje é **global** (um slider que vale pra tudo).

### Desenho proposto

A aba `"llm"` da Settings vira duas subseções claras:

1. **Providers** — as API keys (inalterado, é o que já está lá).
2. **Roles** — uma linha por papel, com modelo + thinking + provider
   resolvido visível:

```
Roles
─────
Planner      [ claude-3-7-sonnet-20250219  ▼ ]  [ thinking: medium ▼ ]   Anthropic
Executor     [ gemini-2.5-flash            ▼ ]  [ thinking: off    ▼ ]   Google
Synthesizer  [ gemini-2.5-flash            ▼ ]  [ thinking: off    ▼ ]   Google
Utility      [ gemini-2.5-flash            ▼ ]  [ thinking: off    ▼ ]   Google

[ Copiar planner para todos ]   [ Resetar defaults ]
```

Regras:

- O dropdown de modelo lista **todos** os modelos disponíveis
  cross-provider (não filtrado por role). O usuário decide.
- Tag de provider à direita é resolvida via
  `getProviderForModel(model).label` (da Spec 01).
- `ThinkingLevelPicker` passa a ser **por role**. Cada row consulta
  `ProviderPlugin.capabilities.thinking?.supported` (Spec 03) pra
  enumerar os níveis válidos daquele modelo. Role cujo modelo não
  suporta thinking esconde o picker.
- Cada role tem um tooltip com descrição curta do papel.

### Modo simples (progressive disclosure)

Pra quem não quer configurar 4 dropdowns, um toggle no topo da subseção
Roles:

```
◉ Configuração simples (1 modelo para tudo)
○ Configuração por papel (avançado)
```

No modo simples, um único dropdown de modelo aplica-se a todas as 4
roles. Ao trocar pra avançado, as 4 roles começam todas com o valor
simples e daí o usuário diverge. Persistência é sempre o JSON
`roles: Record<RoleName, RoleBinding>` — o modo é só afetação de UI,
nada no schema.

### `OllamaSettings` — atualização dos atalhos

A lista curada em `OllamaSettings.tsx:24–56` hoje tem
`role: 'worker' | 'maestro'`:

- **Renomear** o campo: `suggestedRole: 'planner' | 'executor'` (mais
  preciso — "isWeak: true" = planner só para tarefas rasas, modelos
  pequenos; "worker" grande = executor pesado).
- **Dois botões → um dropdown** por modelo: `Aplicar a [Planner |
  Executor | Synthesizer | Utility]`. O item default do dropdown é o
  `suggestedRole`.

Prop do componente muda:

```ts
// antes:
onModelSet: (role: 'workerModel' | 'maestroModel', value: string) => void;
// depois:
onModelSet: (role: RoleName, value: string) => void;
```

### Mudanças em `src/App.tsx`

```ts
// antes (L42):
const [models, setModels] = useState({
  maestroModel: 'claude-3-7-sonnet-20250219',
  workerModel: 'gemini-2.0-flash',
});

// depois:
const [roles, setRoles] = useState<Record<RoleName, RoleBinding>>(DEFAULT_ROLES);

// handler (antes L426):
const handleChangeRole = async (
  role: RoleName,
  patch: Partial<RoleBinding>,
) => {
  const next = { ...roles, [role]: { ...roles[role], ...patch } };
  setRoles(next);
  await window.redbusAPI.saveProviderConfigs({ ...keys, roles: next });
};
```

### IPC

Canal `saveProviderConfigs` / `getProviderConfigs` muda payload:

```ts
// antes:
{ openAiKey, anthropicKey, googleKey, ollamaUrl, ollamaCloudKey,
  ollamaCloudUrl, maestroModel, workerModel }

// depois:
{ openAiKey, anthropicKey, googleKey, ollamaUrl, ollamaCloudKey,
  ollamaCloudUrl, roles: Record<RoleName, RoleBinding> }
```

### Validação antes de salvar

1. As 4 roles têm `model` não-vazio.
2. `getProviderForModel(model)` não lança para nenhum deles.
3. Pro provider resolvido, a API key correspondente existe (exceto
   Ollama local — tem `ollamaUrl`).
4. Se `thinkingLevel` está setado, precisa constar em
   `plugin.capabilities.thinking.supported` pro modelo escolhido.

Falha vira erro inline na linha da role, não toast global.

### i18n (novas chaves em `src/i18n/index.tsx`)

```
settings.llm.roles.title            → "Papéis (Roles)"
settings.llm.roles.simpleMode       → "Configuração simples"
settings.llm.roles.advancedMode     → "Configuração por papel"
settings.llm.roles.copyPlannerToAll → "Copiar planner para todos"
settings.llm.roles.resetDefaults    → "Resetar defaults"
settings.llm.roles.planner.name        → "Planner"
settings.llm.roles.planner.description → "Decide o próximo passo e orquestra. Use um modelo forte em raciocínio."
settings.llm.roles.executor.name        → "Executor"
settings.llm.roles.executor.description → "Executa tarefas com tools (browser, filesystem). Prefira velocidade."
settings.llm.roles.synthesizer.name        → "Synthesizer"
settings.llm.roles.synthesizer.description → "Converte resultado técnico em resposta natural."
settings.llm.roles.utility.name        → "Utility"
settings.llm.roles.utility.description → "Tarefas internas (memória, briefings, análises)."
```

## Plano de migração

### Fase 1 — Schema + role resolver + UI (base, sem mudar comportamento)

1. **Schema:** remover colunas `maestroModel`, `workerModel` do
   `CREATE TABLE ProviderConfigs` (`electron/database.ts:161–162`) e a
   linha de migração L186–188. Adicionar coluna `roles TEXT NOT NULL
   DEFAULT '...'` com JSON default (4 roles, ver seção "Contratos").
2. **Backend:** criar `electron/services/roles.ts` com `resolveRole`,
   `chatWithRole`. IPC `saveProviderConfigs`/`getProviderConfigs`
   passam a serializar/deserializar `roles`.
3. **UI:** implementar a aba Roles descrita em "UI de Settings":
   - Novo componente `src/components/Settings/RolePicker.tsx` (1 linha
     = modelo + thinking + tag do provider).
   - Refatorar `src/App.tsx` state de `{ maestroModel, workerModel }`
     para `roles: Record<RoleName, RoleBinding>`.
   - Atualizar `OllamaSettings.tsx` (prop `onModelSet` com `RoleName`,
     botões → dropdown).
   - Adicionar toggle simples/avançado + i18n novas chaves.

**Critério da fase:** app sobe com o novo schema, Settings mostra 4
roles configuráveis (ou 1 no modo simples), salvamento round-trip
funciona, nenhum call site do backend ainda usa as roles — tudo
continua rodando com hardcode temporário pra manter o comportamento.

### Fase 2 — Migrar call sites para `chatWithRole`

Mapeamento 1-para-1 (casa com Spec 04):

| Call site | Role |
|---|---|
| `orchestratorService._runMaestroCore` | `planner` |
| `orchestratorService.synthesizeTaskResponse` | `synthesizer` |
| `llmService.runWorkerStep` | `executor` |
| `memoryService.callWorkerLLM` | `utility` |
| `briefingEngine.callLLM` | `utility` |
| `proactivityEngine` (L288, L383) | `utility` |
| `audioAdapterService.analyze` | `utility` |

Todos perdem o `configs.workerModel || 'gemini-2.5-flash'` / similar.

**Critério:** `grep -rn "maestroModel\|workerModel" electron/` retorna
apenas hits no `database.ts` (e só se ainda não foi removido) e em
`specs/`. Zero hits em `services/`.

### Fase 3 — Loop unificado

1. Extrair `runAgentLoop` de `workerLoop.ts` + `intelligentExtractor.ts`.
2. `workerLoop.executeWorkerOnView` e `intelligentExtractor.runExtraction`
   viram ~15 linhas cada, configurando `toolAllowlist` e `systemPrompt`.
3. HITL consent flow (`consentResolvers` de `workerLoop.ts:18–30`) migra
   para dentro de `runAgentLoop`, reusável por ambos (e pela Spec 5.1 HITL).

**Critério:** `workerLoop.ts` e `intelligentExtractor.ts` compartilham
o mesmo laço. Total de linhas de código de "agent loop" no repo cai de
~500 (somados) para ~200 + dois wrappers de ~20.

### Fase 4 — `spawn_subagent` (opt-in)

1. Registrar o `ToolPlugin` (apenas quando `configs.enableSubagents === true`
   ou feature flag) — fica desligado por default na primeira release.
2. Adicionar teste `test/subagentDepthLimit.test.ts` validando que uma
   cadeia artificial de 3 níveis é barrada.
3. Adicionar `ctx.agentDepth` ao `ToolContext` (tipo existente em
   `electron/plugins/types.ts:121–125`).

**Critério:** com o flag ligado, um planner consegue chamar
`spawn_subagent({ instruction: "..." })`, o subagent roda em loop
isolado com allowlist, e o resultado volta como `tool` message. Com o
flag desligado, a tool não aparece na lista.

### Fase 5 — Skills roteadas por role

Integra com Spec 02. Skills ganham frontmatter `role` e `allowlist`. O
skill runner usa `runAgentLoop` em vez da invocação direta atual.

## Critérios de sucesso globais

- `grep -rn "maestroModel\|workerModel" electron/` — só hits em
  comentários/docs, zero em código de produção.
- Settings → Roles mostra as 4 roles configuráveis (ou 1 dropdown no
  modo simples), cada uma com `model` + `thinkingLevel` independentes,
  e `ThinkingLevelPicker` esconde automaticamente quando o modelo da
  role não suporta thinking.
- `OllamaSettings.tsx` não usa mais os literais `'maestroModel'` /
  `'workerModel'` — tipagem `RoleName` em toda a prop chain.
- `workerLoop.ts` + `intelligentExtractor.ts` somados ≤ 150 linhas
  (hoje: 260 + ~300).
- Teste `test/roleResolver.test.ts`: resolver devolve bindings corretos,
  aplica defaults sensatos quando JSON está mal-formado.
- Teste `test/agentLoop.test.ts`: roda um loop com mock de provider e
  3 tools, termina em `commit`.
- Teste `test/subagentDepthLimit.test.ts`: spawn em depth=2 retorna erro,
  depth=1 passa.
- App continua abrindo com o schema novo; nenhum fluxo do usuário
  (chat simples, browser task, briefing matinal) quebra.

## Fora de escopo desta spec

- **Paralelização de subagents** (`Promise.all`) — deixar pra quando
  `spawn_subagent` tiver uso real. Começa síncrono.
- **`parentSessionId` / announce queue / transcripts de subagent** — o
  `oc` tem tudo isso porque é multi-user/multi-session. Redbus não
  precisa no curto prazo.
- **HITL dentro do subagent** — a tool de approval (Spec 5.1) se aplica
  igual, mas o fluxo de UI pode precisar saber "quem pediu" se subagents
  paralelos existirem. Fora de escopo por ora.
- **Role dinâmica (LLM escolhe role no runtime)** — por ora, role é
  definida pelo call site ou pelo frontmatter da skill.
- **Migração de dados do schema antigo** — premissa de `specs/README.md`:
  versão nova, sem migração.

## Ordem sugerida de execução

1. Fase 1 (schema + resolver + Settings UI) — 1 PR.
2. Fase 2 (migrar call sites) — pode ser 1 PR por service ou agrupado; tem
   sobreposição forte com Spec 04, dá pra fazer junto.
3. Fase 3 (loop unificado) — 1 PR isolado.
4. Fase 4 (subagent tool, flag desligado) — 1 PR.
5. Fase 5 (skills → role) — depois que Spec 02 estiver pronta.

## Dependências entre specs

- **Spec 01** (plugin registry): pré-requisito. `chatWithRole` usa
  `getProviderForModel` do registry.
- **Spec 03** (thinking): cada role carrega um `thinkingLevel`. A
  resolução `resolveThinkLevel(db, model)` passa a ser
  `resolveThinkLevelForRole(db, role)`.
- **Spec 04** (consumidores residuais): casa-se naturalmente com a Fase 2
  daqui. Fazer juntos evita tocar os mesmos arquivos duas vezes.
- **Spec 02** (Skills): Fase 5 daqui depende de Spec 02 estar pronta.
- **Spec 5.1** (HITL): o `runAgentLoop` é o lugar natural de plugar o
  approval gate — tool call → approval → execução.

