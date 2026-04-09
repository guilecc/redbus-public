# Database Schema & FTS5 Rules

## 1. Schema Management (Electron + better-sqlite3)
The database filename is typically `.redbus` (or as defined in `database.ts`).
- **Initial Setup:** The `initializeDatabase()` function in `database.ts` must be the ONLY place where tables are created or modified at startup.
- **Table Integrity:** Every table must have a primary key `id` (usually `INTEGER PRIMARY KEY AUTOINCREMENT` or `TEXT` for UUIDs).
- **Versioning:** Any schema change MUST be accompanied by a manual or automatic migration step in `database.ts`.

## 2. Table Organization (17 Tables)
Tables are organized by domain (Architecture Core Section 11):
- **Infrastructure:** `UserConfig`, `ProviderConfigs`, `AppSettings`, `SecureVault`.
- **Identity/Soul:** `UserProfile`.
- **Logic & Execution:** `LivingSpecs`, `RoutineExecutions`, `ForgeSnippets`, `ForgeExecutions`.
- **Conversation & Memory:** `Conversations`, `ChatMessages`, `ConversationSummary`, `MemoryFacts`, `EmbeddingsMemory`, `VectorMemory`.
- **Sensors & OCR:** `ScreenMemory`, `MeetingMemory`.

## 3. Full-Text Search (FTS5) Standard
Any content that needs fast retrieval by text must use a Virtual FTS5 table and a corresponding trigger.
- **Triggers:** Use `AFTER INSERT` and `AFTER UPDATE` triggers on the original table to keep the FTS5 virtual table synchronized.
- **Searching:** Use the `MATCH` operator specifically within `memorySearchService.ts`.
- **Tables involved:** `ChatMessages`, `MemoryFacts`, `ScreenMemory` (OCR output).

## 4. Query Performance & Joins
- **Indexing:** Columns frequently used in `WHERE` or `JOIN` (e.g., `conversation_id`, `created_at`) MUST have indexes.
- **WAL Mode:** We use Write-Ahead Logging for high-concurrency performance (reading while writing).
- **Pre-compiled Statements:** Use `db.prepare()` for frequently executed queries to improve performance.

## 5. Data Privacy & Cleanup
- **Compaction:** Periodically clean up or summarize old data (messages/captures) based on user-defined retention policies (see `23_DATA_RETENTION.md`).
- **Sensitive Data:** If a table contains secrets (API keys, passwords), use `vaultService.ts` encrypt/decrypt logic instead of raw strings.
