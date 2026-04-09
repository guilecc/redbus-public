# 05. TESTING STRATEGY

## Princípio TDD
Toda nova funcionalidade deve ter testes correspondentes. Testes devem ser executados com `npm run test` antes de qualquer merge.

## Separação de Camadas
- **Testes do Main Process**: Testam services (orchestrator, scheduler, memory, vault, forge, sensors, etc.) isoladamente com mocks de SQLite in-memory.
- **Testes do Renderer**: Testam componentes React isoladamente.
- **Testes IPC**: Validam a comunicação main↔renderer.

## Convenções
- Ficheiros de teste em `tests/` ou `__tests__/` co-localizados.
- Mock do SQLite: `new Database(':memory:')` + schema via `initializeDatabase`.
- Mock do Electron: `BrowserWindow`, `clipboard`, `app` etc.
- Funções `_reset*` exportadas para limpeza de estado global entre testes (ex: `_resetSensorState`, `_resetEngine`).

## Cobertura Crítica
- Schema migrations (ALTER TABLE com try/catch)
- Cron parsing e backoff schedule
- FTS5 search (ChatMessages, ScreenMemory, MeetingMemory)
- Context builder (4+1 tiers)
- Compaction logic
- Factory reset
- Sensor toggle + persistence
- ProactivityEngine cooldown/level logic

