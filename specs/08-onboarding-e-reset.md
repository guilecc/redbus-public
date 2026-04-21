# Spec 08 — Onboarding de primeiro uso + reset para tutorial

> **Motivação direta:** hoje `electron/services/roles.ts:26-31` e
> `electron/database.ts:163` carregam `DEFAULT_ROLES` com IDs de snapshots
> congelados (`claude-3-7-sonnet-20250219`, `gemini-2.5-flash`). Esses nomes
> envelhecem, podem deixar de existir na API do provider e, pior: o app
> **boota direto no layout principal** sem ter key nenhuma, então o maestro
> tenta chamar `claude-3-7-sonnet-20250219` sem `anthropicKey` e explode.
>
> Esta spec substitui os defaults hardcoded por um **fluxo de configuração
> inicial** que descobre modelos em tempo real, deixa o usuário mapear roles
> a partir do catálogo vivo, e garante que um factory-reset traz o app de
> volta para o mesmo fluxo.

---

## Objetivo

1. **Remover** os IDs de modelo hardcoded como default (`roles.ts:26-31` e o
   SQL DEFAULT em `database.ts:163`). Estado "sem configuração" passa a ser
   **estado de primeira classe**.
2. Gate de boot em `src/App.tsx`: se setup não completo → renderiza wizard;
   senão → renderiza layout normal.
3. Wizard de onboarding que cobre três caminhos: **cloud** (keys), **local**
   (Ollama pull) e **misto**. Cada step valida antes de avançar.
4. Mapeamento de roles a partir do **catálogo vivo** (não de strings pinadas
   no código). Provider plugins sugerem quais modelos servem bem para
   `planner` vs `utility` via capability metadata.
5. Reset: dois níveis (soft = redo setup / hard = factory reset) e ambos
   levam o usuário de volta ao wizard na próxima inicialização.

---

## Estado atual

| Peça | Onde está | Status |
|---|---|---|
| Setup gate no boot | — | **Inexistente**. App renderiza direto. |
| Defaults hardcoded | `electron/services/roles.ts:26-31` | 2 models pinados. |
| Default SQL duplicado | `electron/database.ts:163` | Mesmo JSON literal. |
| Listagem de modelos remota | IPC `settings:fetch-models` em `ipcHandlers.ts:163` | ✓ Pronto. |
| Save de provider key | IPC `settings:save-provider` (L132) | ✓ Pronto. |
| Ollama daemon probe | IPC `ollama:status` (L178) | ✓ Pronto. |
| Ollama list local | IPC `ollama:list` (L190) | ✓ Pronto. |
| Ollama pull com progresso | IPC `ollama:pull` (L202) + `ollama:pull-progress` (ollamaService.ts:52) | ✓ Pronto. |
| Factory reset | IPC `factory-reset` (L526) — limpa DB + sessões browser + channels | Precisa de ganho: limpar setup flag. |
| UI de Settings hoje | `src/components/Settings/{OllamaSettings,RolePicker,…}.tsx` | Reaproveita parcialmente. |
| Flag de "setup completo" | — | **Inexistente**. Adicionar em `AppSettings`. |

**O que o `oc` faz de análogo (referência, não para copiar 1:1):**

- `oc/src/commands/onboard*.ts` — CLI-wizard que pergunta provider, testa key,
  lista modelos, salva em config.
- `oc/docs/plugins/sdk-provider-plugins.md` define que cada provider plugin
  declara modelos "recomendados" em vez de o core manter uma lista.

---

## Contratos (plano de destino)

### 1. `ProviderPlugin` ganha metadata de recomendação

Em `electron/plugins/types.ts:98`:

```ts
export type RoleHint = 'planner' | 'executor' | 'synthesizer' | 'utility';

export interface ModelRecommendation {
  /** Model id that, quando listado por listModels, é bom para esse role. */
  matches: (modelId: string) => boolean;
  /** Ordem de preferência entre candidatos do mesmo provider (asc). */
  rank?: number;
}

export interface ProviderPlugin {
  // ...existente
  /**
   * Quais modelos deste provider servem para cada role. A UI cruza isso
   * com o catálogo **vivo** (listModels) — nunca pina um id específico.
   */
  recommendedFor?: Partial<Record<RoleHint, ModelRecommendation>>;
}
```

Exemplo (plugin Anthropic):

```ts
recommendedFor: {
  planner:     { matches: (id) => /sonnet|opus/i.test(id), rank: 1 },
  synthesizer: { matches: (id) => /haiku/i.test(id),       rank: 1 },
}
```

Nada de `'claude-3-7-sonnet-20250219'` no código — **regex sobre o catálogo
retornado pelo provider**. Se sair `claude-sonnet-5` amanhã, o match pega.

### 2. Novo estado "roles não configuradas"

Em `electron/services/roles.ts`:

- Renomear `DEFAULT_ROLES` → `EMPTY_ROLES` e torná-lo
  `Partial<Record<RoleName, RoleBinding>>` (tudo `undefined`).
- `DEFAULT_ROLES_JSON` → `'{}'`.
- SQL DEFAULT em `database.ts:163`: passa a ser `DEFAULT '{}'`.
- `parseRolesJson` retorna `Partial<RolesMap>` (map sem fallback).
- `resolveRole(db, role)` lança `SetupRequiredError` se o role não estiver
  bound — orquestrador trata como "peça onboarding antes de chamar chat".

### 3. Flag de setup em `AppSettings`

Reusa a tabela existente (sem schema novo):

- Chave: `setup.completed_at` — ISO timestamp ou `null`.
- Helpers novos em `electron/database.ts`:

```ts
export function isSetupComplete(db): boolean;
export function markSetupComplete(db): void;
export function clearSetupCompletion(db): void;
```

### 4. IPC surface

Novos handlers em `electron/ipcHandlers.ts` (reusa os existentes onde possível):

| IPC | O que faz |
|---|---|
| `setup:status` | `{ completed: boolean; missingRoles: RoleName[]; configuredProviders: string[] }` |
| `setup:recommend-roles` | Dado o catálogo atual (keys + Ollama local), devolve uma **sugestão** de `RolesMap` usando `recommendedFor` |
| `setup:complete` | Recebe `{ roles: RolesMap }`, persiste em `ProviderConfigs.roles`, marca `setup.completed_at`, devolve `{ ok: true }` |
| `setup:reset` | Soft reset: limpa `setup.completed_at` + `ProviderConfigs.roles`; **mantém** histórico, memória e skills |

`factory-reset` existente (L526) ganha duas linhas: `clearSetupCompletion(db)`
garantido no fim (hard reset).

### 5. UI — nova árvore `src/components/Onboarding/`

```
src/components/Onboarding/
  OnboardingShell.tsx     # container + step progress bar + nav
  steps/
    WelcomeStep.tsx       # splash + escolha de caminho (cloud/local/misto)
    ProvidersStep.tsx     # lista os 3 providers cloud, key + validar
    OllamaStep.tsx        # detecta daemon, oferece pulls recomendados
    RolesStep.tsx         # mapeia catálogo → 4 roles (reusa RolePicker)
    ReviewStep.tsx        # mostra resumo, botão Finish
  hooks/
    useSetupStatus.ts     # assina IPC setup:status, re-renderiza no reset
```

Gate no `src/App.tsx` (hoje L42–163 trata do layout direto):

```tsx
const { completed, loading } = useSetupStatus();
if (loading) return <SplashLoader />;
if (!completed) return <OnboardingShell />;
return <MainLayout />;
```

**Reaproveitamento:**

- `ProvidersStep` monta sub-forms que são o mesmo componente de
  `OllamaSettings.tsx` (extraído para `<ProviderKeyForm />` compartilhado).
- `RolesStep` usa o `RolePicker.tsx` já criado na Spec 06 — a única coisa
  nova é a fonte dos candidatos vir do merge `listModels()` de cada plugin
  configurado, sem fallback para IDs pinados.
- `OllamaStep` consome o IPC `ollama:pull-progress` que já existe
  (`ollamaService.ts:52`); UI = barra de progresso + ETA do response body
  stream.

**Fluxo de dados entre steps:** um `OnboardingContext` (React) mantém
`{ keys: {openai?, anthropic?, google?, ollamaCloud?}, ollama: { pulledModels:
string[] }, roles: Partial<RolesMap> }` em memória até o `ReviewStep`. Só no
**Finish** é que os IPCs `settings:save-provider` + `setup:complete` são
chamados, numa transação lógica — falha no meio = rollback em memória e
usuário volta ao step problemático.

### 6. i18n

Strings novas em `src/i18n/index.tsx` sob a chave `onboarding.*`:

- `onboarding.welcome.title`, `onboarding.welcome.choose_path`
- `onboarding.providers.cloud_label`, `onboarding.providers.key_invalid`
- `onboarding.ollama.daemon_missing`, `onboarding.ollama.pull_progress`
- `onboarding.roles.title`, `onboarding.roles.helper_text`
- `onboarding.review.confirm`, `onboarding.review.finish`
- `settings.reset.redo_setup_button`, `settings.reset.redo_setup_desc`

Tooltip de cada role usa as descrições já previstas na Spec 06 (não duplica).


---

## Plano em 5 fases

### Fase 1 — Defaults vazios + setup flag (quebra `main` de propósito)

1. `roles.ts`: `DEFAULT_ROLES` → `EMPTY_ROLES` (todos `undefined`),
   `DEFAULT_ROLES_JSON` → `'{}'`. `resolveRole` lança `SetupRequiredError`
   se role não estiver bound.
2. `database.ts:163`: SQL DEFAULT → `'{}'`.
3. `AppSettings` helpers: `isSetupComplete`, `markSetupComplete`,
   `clearSetupCompletion`.
4. IPCs `setup:status` + `setup:complete` + `setup:reset`. Handler novo de
   erro no `orchestrator:send-task` propagando `SetupRequiredError` como
   `{ code: 'SETUP_REQUIRED' }` para a UI.
5. **Critério:** boot limpo quebra com erro claro de `SETUP_REQUIRED` —
   ainda **sem** UI de onboarding. Fluxo testável via IPC script.

### Fase 2 — `recommendedFor` nos provider plugins

1. Adiciona `recommendedFor` em `ProviderPlugin` (tipos).
2. Implementa nos 3 plugins cloud atuais (Anthropic/OpenAI/Google) com regex
   sobre o id. Lista canônica fica em cada plugin, nunca em core.
3. `setup:recommend-roles` IPC lê keys atuais + Ollama local, chama
   `listModels` de cada um, cruza com `recommendedFor`, devolve
   `Partial<RolesMap>` com `rank` menor ganhando.
4. **Critério:** testável via devtools —
   `window.api.invoke('setup:recommend-roles')` devolve mapeamento plausível
   mesmo sem UI pronta.

### Fase 3 — UI do wizard (happy path)

1. Cria `src/components/Onboarding/OnboardingShell.tsx` + 5 steps.
2. Extrai `<ProviderKeyForm />` de `OllamaSettings.tsx` para reúso.
3. Gate no `App.tsx`: `useSetupStatus()` decide Shell vs MainLayout.
4. `OllamaStep` usa `ollama:status` + `ollama:pull` + `ollama:pull-progress`
   (tudo existente).
5. `RolesStep` popula dropdowns cruzando catálogo vivo com `recommendedFor`;
   defaults vêm de `setup:recommend-roles`.
6. Finish chama `settings:save-provider` (n vezes) + `setup:complete`.
7. **Critério:** boot de DB zerado → wizard → finish → app abre normalmente
   e o maestro consegue responder "oi" sem tocar em código hardcoded.

### Fase 4 — Resets e re-entrada

1. Botão `Settings → "Redo setup"` chama `setup:reset` — usuário volta ao
   wizard **sem perder chats/memória**.
2. `factory-reset` (L526) já limpa DB; garantir no fim dele
   `clearSetupCompletion(db)` (idempotente, mas explícito).
3. Após qualquer reset, `setup:status` emite evento broadcast no `streamBus`
   → `useSetupStatus` re-renderiza o Shell imediatamente (sem F5).
4. **Critério:** clicar Factory Reset → app troca para Shell em <1s, sem
   restart manual.

### Fase 5 — Polimento e edge cases

- **Daemon Ollama ausente:** step oferece link pra `ollama.com/download` +
  botão "Pular Ollama".
- **Key inválida:** feedback inline no step, não deixa avançar.
- **Sem nenhum provider configurado:** Finish bloqueado com mensagem
  "configure pelo menos 1 provider".
- **Role sem candidato:** bloqueia avanço do `RolesStep`; botão "copiar do
  planner para os demais" destrava o caso simples.
- **Boot offline:** `listModels` falha → skeleton com retry + escape hatch
  "aceitar id manual" (caso o usuário saiba o id exato e não tenha rede).

---

## Critérios de sucesso

- [ ] `git grep -E "claude-3-7|gemini-2\.5-flash"` em `electron/` e `src/`
      retorna zero hits fora de testes/specs. Todo nome de modelo vem de
      `listModels()` em runtime ou de regex `recommendedFor`.
- [ ] `electron/services/roles.ts` não exporta mais `DEFAULT_ROLES` com
      valores populados.
- [ ] `database.ts:163` tem `DEFAULT '{}'`.
- [ ] Boot com `ProviderConfigs.roles = '{}'` abre o wizard, nunca o layout
      principal.
- [ ] "Redo setup" preserva `ChatMessages`, `MemoryFacts`, `SkillsIndex`.
- [ ] `factory-reset` leva o app de volta ao wizard sem reiniciar o
      processo.
- [ ] Lançar um modelo novo num provider (ex.: sair `claude-sonnet-5`)
      funciona **sem mudanças de código** — aparece no dropdown assim que
      `listModels` devolver.
- [ ] Wizard navegável por teclado (a11y básico).

## Fora de escopo

- Suporte a providers custom além de Ollama (BYO-endpoint
  OpenAI-compatible) — spec futura.
- Import/export de perfil de configuração entre máquinas.
- Setup remoto / multi-device sync do estado de onboarding.
- Atualização contínua do catálogo (refresh automático periódico) — v1
  refaz só quando a UI de Settings é aberta.

## Ordem sugerida de execução

Fase 1 (quebra) → Fase 2 (recommendations) → Fase 3 (UI) → Fase 4 (reset) →
Fase 5 (edge cases).

Entre Fases 1 e 3 o app fica tecnicamente inutilizável para quem clonar o
repo; aceitável pela premissa do README (versão nova, sem compat).

## Dependências

- **Pré-requisito:** Spec 01 (plugin registry com `listModels`).
- **Pré-requisito:** Spec 06 (roles + `RolePicker`).
- **Casa com:** Spec 5.1 HITL — onboarding pode ter um toggle "exigir
  confirmação para comandos perigosos" que pré-configura a policy do plugin
  HITL.
- **Independente de:** Spec 02 (Skills), 03 (thinking), 07 (hooks).


