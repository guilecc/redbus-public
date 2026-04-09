# 12. SOUL (ALMA) & MEMORY

## UserProfile — A Alma do Agente
```sql
CREATE TABLE UserProfile (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT, role TEXT, communication_style TEXT,
  interests TEXT,     -- JSON array
  tools TEXT,         -- JSON array
  raw_notes TEXT,     -- anotações livres
  system_prompt_compiled TEXT  -- system prompt final compilado
);
```

### Compilação do System Prompt
`updateCompiledPrompt()` no orchestratorService gera o `system_prompt_compiled` concatenando:
- Nome, papel e estilo do utilizador
- Interesses e ferramentas
- Data atual
- Instruções fixas do agente (identidade, regras, FORMATs)

### Onboarding
Se UserProfile não existe, o Maestro opera em modo entrevista: pergunta nome, papel, estilo, interesses. Quando tem informação suficiente, emite `finalize_soul_setup` com JSON que popula o profile.

## MemoryFacts — Memória de Longo Prazo
```sql
CREATE TABLE MemoryFacts (
  id TEXT PRIMARY KEY,
  fact TEXT NOT NULL,
  category TEXT,           -- ex: 'work', 'personal', 'preference'
  source TEXT,             -- 'conversation', 'routine', 'onboarding'
  confidence REAL DEFAULT 0.8,
  supersededBy TEXT,       -- referência a facto mais recente
  active INTEGER DEFAULT 1,
  createdAt DATETIME, updatedAt DATETIME
);
```

### Ciclo de Vida dos Factos
1. **Extração**: O Maestro extrai factos das conversas via `saveFactsFromAssistantMessage`.
2. **Rotinas**: `saveFactFromRoutine` salva resultados de rotinas como factos (source='routine').
3. **Supersessão**: Factos obsoletos marcados com `supersededBy` + `active=0`.
4. **Contexto**: `getActiveMemoryFacts(limit=30)` alimenta o context builder (Tier 1).
5. **IPC**: Expostos ao renderer via `memory:get-facts`, `memory:update-fact`, `memory:delete-fact`.

## memorySearchService — Busca Unificada FTS5
`searchAll(db, query)` busca em 3 índices FTS5 simultaneamente:
- `ChatMessages_fts` (mensagens)
- `ScreenMemory_fts` (OCR)
- `MeetingMemory_fts` (reuniões)

Retorna resultados unificados com `source`, `snippet`, `timestamp`, ordenados por relevância (rank).

