# Backend Architecture & Service Rules

## 1. Local-First IPC Strategy
All communication between the React frontend and the Node.js main process must go through `contextBridge` in `preload.ts`.
- **Naming Convention:** Use `window.redbusAPI` methods.
- **Safety:** Never expose `remote` or raw `ipcRenderer` to the frontend.
- **Error Handling:** All IPC handlers in `ipcHandlers.ts` must return a structured response `{ success: boolean; data?: any; error?: string }` or throw caught errors that the frontend can handle.

## 2. Service-Oriented Main Process
Business logic should NEVER reside in `main.ts` or `ipcHandlers.ts`. 
- Every major feature must have a corresponding service in `electron/services/`.
- Services must be singletons initialized by the `OrchestratorService` or `main.ts`.
- Services should interact via the `StreamBus` if real-time event propagation is needed.

## 3. Database Integrity (SQLite + better-sqlite3)
The database is the source of truth for RedBus.
- **WAL Mode:** Always ensure `PRAGMA journal_mode = WAL` is active for concurrency between the main process and any background workers.
- **Transactions:** Complex operations (like archiving messages or updating memory facts) must use `db.transaction()`.
- **FTS5:** Leverage Full-Text Search 5 for any text-heavy querying (Messages, Screen Memory, Fact Memory).

## 4. Background Workers & Long-Running Tasks
- Long-running tasks (OCR, Transcription, LLM Tool Loops) should ideally run in a way that doesn't block the UI.
- Use `worker_threads` for CPU-intensive tasks like Whisper (STT) or heavy OCR.
- The `WorkerLoop` handles the iterative LLM tool-calling logic (max 15 steps) to prevent infinite loops.

## 5. Secure Vault Management
- Sensitivity data (API Keys, tokens) must NEVER be stored in plain text.
- Use `vaultService.ts` which utilizes Electron's `safeStorage` to encrypt/decrypt strings using OS-level credentials.
- Injected Python scripts must receive vault secrets via temporary environment variables/memory, never written to disk.
