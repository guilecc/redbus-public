# 16. SKILL LIBRARY & FORGE

## Conceito
O Forge permite ao agente criar, versionar e reutilizar scripts Python como "skills". O Maestro decide FORMAT D (usar skill existente) ou FORMAT E (criar nova + executar).

## ForgeSnippets (Tabela)
```sql
CREATE TABLE ForgeSnippets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  code TEXT NOT NULL,
  input_schema TEXT,        -- JSON Schema dos args esperados
  output_schema TEXT,       -- JSON Schema do output
  tags TEXT,                -- JSON array de tags
  version INTEGER DEFAULT 1,
  use_count INTEGER DEFAULT 0,
  last_used_at DATETIME,
  createdAt DATETIME, updatedAt DATETIME
);
```

## ForgeExecutions (Log)
```sql
CREATE TABLE ForgeExecutions (
  id TEXT PRIMARY KEY,
  snippetId TEXT NOT NULL,
  input TEXT,               -- JSON dos args
  output TEXT,              -- stdout capturado
  status TEXT CHECK(status IN ('ok','error')),
  durationMs INTEGER,
  executedAt DATETIME
);
```

## forgeService.ts
- `listSnippets(db)` — lista todas as skills
- `readSnippet(db, name)` — lê por nome
- `writeSnippet(db, {name, description, code, input_schema, output_schema, tags})` — INSERT OR REPLACE + incrementa version
- `deleteSnippet(db, name)` — remove
- `executeSnippet(db, name, args)` — lê snippet, injeta args como JSON em stdin, executa Python, log em ForgeExecutions, incrementa use_count/last_used_at

### Execução
1. Lê snippet por nome
2. Cria temp file com código
3. Injeta tokens do Vault como env vars
4. Executa `python3` com JSON args em stdin (via `REDBUS_ARGS`)
5. Captura stdout/stderr
6. Salva log em ForgeExecutions
7. Retorna `{output, status, durationMs}`

## SkillManager (UI)
Componente React para gestão visual de skills:
- Lista com search + filtro por tags
- Criação com wizard (nome, descrição, código, schemas)
- Editor de código embutido
- Visualização de histórico de execuções
- Toggle de snippets I/O schema

