# 01. ARCHITECTURE CORE

## Visão Geral
RedBus é um **Hub de Agentes Autônomos Local** — app desktop nativa Electron + React + SQLite. Tudo roda na máquina do utilizador. Zero servidores cloud, zero contas, zero senhas armazenadas.

## Stack
| Camada | Tecnologia |
|--------|-----------|
| Runtime | Electron (Node.js main process) |
| UI | React + Vite (renderer process) |
| DB | better-sqlite3 (ficheiro `.redbus`, WAL mode) |
| IPC | contextBridge + ipcMain/ipcRenderer |
| LLM | Agnóstico: OpenAI, Anthropic, Google Gemini |
| OCR | tesseract.js (eng+por) |
| STT | @xenova/transformers whisper-tiny (WASM, local) |

## Processos
```
Main Process (Node.js)
├── main.ts             → bootstrap, janela, tray
├── database.ts         → schema SQLite (17 tabelas + 3 FTS5)
├── ipcHandlers.ts      → todos os handlers IPC
├── preload.ts          → contextBridge (window.redbusAPI)
├── browserManager.ts   → BrowserViews + snapshot + DOM actions
└── services/
    ├── orchestratorService  → Maestro LLM (planning, 8 FORMATs)
    ├── llmService           → fetch com timeout + DOM extraction
    ├── workerLoop           → loop agentic tool-use (15 steps max)
    ├── schedulerService     → cron engine (60s poll, backoff)
    ├── archiveService       → ChatMessages CRUD + compaction
    ├── memoryService        → MemoryFacts CRUD
    ├── memorySearchService  → FTS5 search unificado
    ├── vaultService         → SecureVault (safeStorage encrypt)
    ├── forgeService         → ForgeSnippets + exec shell
    ├── pythonExecutor       → Python child_process + vault inject
    ├── sensorManager        → 5 sensores ambientais
    ├── proactivityEngine    → subconsciente autônomo (LLM filter)
    ├── notificationService  → notificações OS nativas
    ├── screenMemoryService  → ScreenMemory OCR + FTS5
    ├── accessibilitySensor  → JXA macOS AX tree
    ├── ocrWorker            → tesseract.js worker singleton
    ├── audioAdapterService  → Gemini/Whisper + MeetingMemory
    ├── audioRoutingService  → macOS aggregate device routing
    ├── localTranscriber     → whisper-tiny em worker_threads
    └── providerService      → lista modelos das 3 APIs

Renderer Process (React/Vite)
├── App.tsx              → state central, routing por activeView
└── components/
    ├── Chat/            → MessageList, ChatInput, MessageBubble, AgentTaskProgress
    ├── Layout/          → TitleBar (nav: chat, history, skills, routines, settings)
    ├── Settings/        → SkillManager (CRUD ForgeSnippets)
    ├── Routines/        → RoutineManager, RoutineCard, RoutinePipeline
    ├── Meeting/         → MeetingReview (Ata Viva)
    ├── Widget/          → WidgetOverlay (janela flutuante gravação)
    └── Onboarding/

Widget Window (janela flutuante BrowserWindow separada)
└── WidgetOverlay.tsx    → controle gravação áudio meeting
```

## Princípios
1. **Zero Senhas** — Sessão persistente `persist:redbus` em BrowserViews.
2. **O Cofre** — Tudo no SQLite local (`.redbus`).
3. **Eficiência de Tokens** — Maestro (grande) planeia, Worker (rápido) executa.
4. **Privacidade** — Apenas LLM API calls saem da máquina.
5. **WAL Mode** — `journal_mode = WAL` para concorrência.

## Schema SQLite (17 tabelas)
| Tabela | Função |
|--------|--------|
| UserConfig | Key-value config |
| Conversations | Container de conversas |
| LivingSpecs | Specs de tarefas (status, cron, backoff, timezone) |
| RoutineExecutions | Log execuções cron (ok/error/skipped) |
| EmbeddingsMemory | Preparado para embeddings |
| VectorMemory | Idem |
| UserProfile | "Alma" — nome, role, system_prompt_compiled |
| ProviderConfigs | API keys + modelos (single row, id=1) |
| ChatMessages | Histórico msgs (com flag `compacted`) |
| ConversationSummary | Resumo rolling compactado (single row) |
| MemoryFacts | Factos longo prazo (category, confidence, supersededBy) |
| ScreenMemory | OCR de capturas de ecrã (text_hash dedup) |
| SecureVault | Tokens cifrados pelo OS |
| ForgeSnippets | Skills Python reutilizáveis (version, use_count) |
| ForgeExecutions | Log exec snippets |
| MeetingMemory | Transcrições + análises reuniões |
| AppSettings | Key-value settings app |

