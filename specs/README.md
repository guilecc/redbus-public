# Specs de Planejamento — Refatoração inspirada no OpenClaw

Especificações curtas para serem referenciadas em prompts futuros ao evoluir o
`redbus`. Cada spec descreve o *como está hoje*, o *padrão de inspiração no
`oc/`* (OpenClaw) e um **plano de execução** para uma nova versão do `redbus`.

> **Premissa:** esta é uma **versão nova do app**. Não há preocupação com
> migração de dados, retrocompat de schema ou shims para storages antigos —
> as specs assumem que podemos quebrar formatos e tabelas quando necessário.

As specs são intencionalmente **independentes** — cada uma pode ser executada
como uma feature isolada, em qualquer ordem, embora a ordem sugerida seja:

1. [`01-providers-e-tooling.md`](./01-providers-e-tooling.md)
   Arquitetura de providers LLM + tool calling via plugins.
2. [`02-forge-e-skills.md`](./02-forge-e-skills.md)
   Substituir/ampliar o `forgeService` com o modelo *Skills* (markdown +
   scripts).
3. [`03-thinking-e-reasoning.md`](./03-thinking-e-reasoning.md)
   Stream unificado de thinking + níveis de raciocínio por provider.
4. [`04-consumidores-residuais.md`](./04-consumidores-residuais.md)
   Migrar `orchestratorService` (maestro), `memoryService`,
   `briefingEngine`, `proactivityEngine` e `audioAdapterService` para o
   registry da Spec 01, eliminando `if (model.includes(...))` residuais.
5. [`05-analise-profunda.md`](./05-analise-profunda.md)
   **Não é spec executável** — é o inventário ranqueado de oportunidades
   adicionais que o `oc` demonstra (HITL, hooks, auth rotation, MCP,
   prompt cache, slash commands, doctor, guardrails, …) para derivar
   specs futuras conforme a prioridade.
6. [`06-roles-e-subagents.md`](./06-roles-e-subagents.md)
   Generalizar `maestroModel`/`workerModel` em **roles nomeadas**
   (`planner`/`executor`/`synthesizer`/`utility`), unificar
   `workerLoop` + `intelligentExtractor` num único `runAgentLoop`, e
   habilitar `spawn_subagent` opcional inspirado em
   `oc/src/agents/subagent-*`.
7. [`07-hook-system.md`](./07-hook-system.md)
   Promove o item 5.2 a plano executável: 8 hook points nomeados
   (`before_agent_start`, `before_prompt_build`, `llm_input`/`llm_output`,
   `before_tool_call`/`after_tool_call`, `before_message_write`, `agent_end`)
   que plugins registram via `api.registerHook(...)`. Habilita HITL (5.1)
   como plugin e substitui patches hard-coded no `orchestratorService`.
8. [`08-onboarding-e-reset.md`](./08-onboarding-e-reset.md)
   Remove os IDs de modelo hardcoded como default
   (`claude-3-7-sonnet-20250219`, `gemini-2.5-flash` em `roles.ts` +
   `database.ts`) e substitui por um wizard de primeiro uso que descobre
   modelos em tempo real via `listModels()`, com recomendação por role
   declarada nos provider plugins (`recommendedFor`). Inclui flag
   `setup.completed_at` em `AppSettings`, gate de boot em `App.tsx` e
   fluxo de soft-reset / factory-reset que levam de volta ao wizard.
9. [`09-unified-agent-runner.md`](./09-unified-agent-runner.md)
   Consolida `workerLoop.ts` + `intelligentExtractor.ts` num único
   `runAgent(...)` inspirado em `oc/src/agents/pi-embedded-runner/`.
   Introduz registry global de runs, lanes por `sessionId`, `AbortSignal`
   first-class, resultado tipado (`AgentRunResult.meta.stopReason` union
   fechado), loop detection automático e separação Run vs Attempt para
   abrir espaço para failover de provider.

## Premissa comum

O `redbus` hoje trata providers, tools e forge como serviços **centralizados**
em `electron/services/` com branches `if (provider === 'anthropic') …`. O `oc/`
resolve o mesmo problema com um **registry de plugins** onde cada capability
(provider, tool, web-fetch, memory, etc.) é registrada via
`api.registerX(...)`. Esse padrão é a principal inspiração e aparece nas três
specs.

## Arquivos-chave de referência no `oc/`

| Assunto | Arquivo |
|---|---|
| Contrato de plugin | `oc/src/plugins/types.ts` |
| Entry helper | `oc/src/plugin-sdk/plugin-entry.ts` |
| Provider entry helper | `oc/src/plugin-sdk/provider-entry.ts` |
| Tool registrável (exemplo) | `oc/extensions/firecrawl/src/firecrawl-search-tool.ts` |
| Extension mínima | `oc/extensions/firecrawl/index.ts` |
| Skill markdown | `oc/skills/skill-creator/SKILL.md` |
| Think levels canônicos | `oc/src/auto-reply/thinking.shared.ts` |
| Stream de thinking (Anthropic) | `oc/src/agents/anthropic-transport-stream.ts` |

## Arquivos-chave no `redbus` que devem mudar

| Assunto | Arquivo atual |
|---|---|
| LLM multi-provider | `electron/services/llmService.ts` |
| Descoberta de modelos | `electron/services/providerService.ts` |
| Parsers de stream | `electron/services/{ollama,claude}StreamParser.ts` |
| Bus de eventos p/ UI | `electron/services/streamBus.ts` |
| Forge / execução | `electron/services/forgeService.ts` |
| UI de thinking | `src/components/Chat/MessageBubble.tsx` |
| Settings de thinking | `src/components/Settings/OllamaSettings.tsx` |

