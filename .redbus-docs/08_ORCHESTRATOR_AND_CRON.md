# 08. ORCHESTRATOR & CRON SCHEDULER

## Scheduler (schedulerService.ts)
Engine de cron que executa rotinas agendadas.

### Inicialização
No startup, calcula `next_run_at` para todos os specs `ACTIVE` com `cron_expression` não-null, usando `cron-parser` com timezone.

### Poll Loop
`setInterval` de **60 segundos**. A cada tick:
1. Lê todos os LivingSpecs ACTIVE com cron
2. Para cada, verifica `isDue(row, now)`:
   - `enabled === 0` → skip
   - Cron expression marca este minuto? (compara prev run do cron com now)
   - Já executou este minuto? → skip (dedup)
   - Em backoff por erros consecutivos? → skip

### Backoff Schedule
```
1º erro  →  30 seg
2º erro  →  1 min
3º erro  →  5 min
4º erro  →  15 min
5º+ erro →  60 min
```

### Execução
Suporta 2 tipos de payload no spec:
1. **Skill/Python** — Lê skill do ForgeSnippets, executa via `executePython`, sintetiza resposta.
2. **Browser Steps** — Para cada step, cria `createHiddenBrowserView`, extrai DOM, sintetiza resposta.

### Pós-execução
- **Sucesso**: reset `consecutive_errors=0`, salva RoutineExecution (ok), salva facto via `saveFactFromRoutine`, envia `worker:step-updated` ao renderer, notifica via `notifyRoutineSuccess`.
- **Erro**: incrementa `consecutive_errors`, salva RoutineExecution (error), notifica via `notifyRoutineError`.
- Sempre atualiza `next_run_at` e `last_duration_ms`.

### Execução Manual
`runRoutineNow(db, mainWindow, specId)` — mesmo fluxo mas sem verificação de cron/due. Retorna `{status, summary|error}`.

## Orchestrator (orchestratorService.ts)
Ver doc 02_AGENT_ROUTING para detalhes do fluxo de decisão do Maestro.

### synthesizeTaskResponse
Usa o modelo Worker (não o Maestro) para formatar dados brutos JSON em resposta conversacional plain-text. Injeta UserProfile para manter tom/personalidade.

