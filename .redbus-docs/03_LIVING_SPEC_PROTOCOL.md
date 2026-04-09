# 03. LIVING SPEC PROTOCOL

## Conceito
Living Spec = contrato vivo Maestro→Worker. O Maestro cria JSON spec; Workers executam e atualizam status via IPC.

## Tabela LivingSpecs
```sql
CREATE TABLE LivingSpecs (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL,
  status TEXT CHECK(status IN ('DRAFT','ACTIVE','COMPLETED','FAILED')),
  specJson TEXT NOT NULL,
  cron_expression TEXT,
  last_run DATETIME,
  enabled INTEGER DEFAULT 1,
  next_run_at TEXT,
  consecutive_errors INTEGER DEFAULT 0,
  last_error TEXT,
  last_duration_ms INTEGER,
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Ciclo de Vida
1. Maestro cria spec → `ACTIVE`
2. Com `cron_expression` → rotina no schedulerService
3. Sem cron → execução imediata (executeSpec / executePythonSpec)
4. Worker envia `worker:step-updated` via IPC ao renderer
5. Status final: `COMPLETED` ou `FAILED`

## Formatos do specJson
- **Browser**: `{ goal, steps: [{url, instruction}], cron_expression }`
- **Python**: `{ goal, python_script, required_vault_keys, steps: [] }`
- **Skill**: `{ goal, skill_name, skill_args, steps: [] }`

## RoutineExecutions
Log de cada execução cron: id, specId, startedAt, endedAt, status (ok/error/skipped), error, summary, durationMs.

