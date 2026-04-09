# 20. SCREEN MEMORY & OCR

## Conceito
O RedBus pode "ver" o ecrã do utilizador via screenshots + OCR, armazenando o texto reconhecido para busca futura.

## ocrWorker.ts
Worker singleton com tesseract.js:
- Idiomas: `eng+por`
- Inicialização lazy (`ensureWorker`)
- `recognizeFromBuffer(buffer)` → retorna texto reconhecido
- `terminate()` para cleanup

## screenMemoryService.ts
Gestão de ScreenMemory (OCR armazenado).

### Tabela
```sql
CREATE TABLE ScreenMemory (
  id TEXT PRIMARY KEY,
  captured_at TEXT NOT NULL,
  ocr_text TEXT,
  text_hash TEXT,           -- SHA-256 para dedup
  source TEXT DEFAULT 'screen_capture',
  app_context TEXT,         -- app ativa no momento da captura
  createdAt DATETIME
);
```

### FTS5
```sql
CREATE VIRTUAL TABLE ScreenMemory_fts USING fts5(ocr_text, content=ScreenMemory, content_rowid=rowid);
```
Triggers de INSERT/DELETE/UPDATE mantêm o índice sincronizado.

### Dedup
`text_hash` (SHA-256 do `ocr_text`) previne screenshots duplicadas. `INSERT OR IGNORE` com UNIQUE constraint.

### API
- `saveScreenCapture(db, ocrText, appContext)` — salva com dedup
- `searchScreenMemory(db, query)` — FTS5 search com snippets

### Fluxo Completo
1. Vision sensor dispara (30s poll)
2. `screenshot-desktop` captura PNG
3. `ocrWorker.recognizeFromBuffer()` extrai texto
4. `saveScreenCapture()` salva com hash dedup
5. Maestro pode buscar via FORMAT F (`searchScreenMemory`)

## FORMAT F — Search Screen Memory
O Maestro emite spec com `search_screen_memory_query`. O orchestrator executa `searchScreenMemory(db, query)` e sintetiza resposta.

