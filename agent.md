# RedBus Project Rules

## Overview
RedBus is a **Local Autonomous Work Assistant** (Agnostic AI Hub) built with Electron, React, and SQLite.
- **Tech Stack:** Electron (Main), React (Renderer), Better-SQLite3 (DB), Playwright (Automation), Vitest (Tests).
- **Core Principle:** Local-first, Privacy-centric, No Cloud dependencies (except for LLM API calls).

## 1. Documentation First
Refer to `.redbus-docs/` for specific architectural details before any major change.
- `01_ARCHITECTURE_CORE.md`: High-level system overview.
- `BACKEND_RULES.md`: IPC, Service singleton, and SQLite rules.
- `FRONTEND_RULES.md`: TDD, UI aesthetics (Lucide icons), and Vanilla CSS logic.
- `DATABASE_SCHEMA_RULES.md`: Table management and FTS5 search logic.
- `ORCHESTRATION_LLM_RULES.md`: Maestro/Worker planning and tool-calling.

## 2. Development Guidelines (TDD)
- **TDD Requirement:** All new features or refactors MUST have corresponding tests in the `/test` directory.
- **Run Tests:** `npm run test` before submitting changes.
- **Main vs Renderer:** Keep business logic in `electron/services/` and UI logic in `src/components/`.

## 3. UI/UX Aesthetics
- **Vanila CSS:** Do NOT use Tailwind CSS. Use `src/index.css` and `.mtg-*` classes.
- **Lucide Icons:** Use `lucide-react` for all UI icons. Sidebar titles must be lowercase with icons.
- **Dynamic Feedback:** Provide visual feedback for LLM tool-calling (AgentTaskProgress component).

## 4. AI & Orchestration Logic
- **Maestro/Worker:** Distinguish between "Maestro" (Planner) and "Worker" (Executor).
- **Tool-Calling:** Max steps in any agentic loop is 15.
- **Privacy:** Never leak sensitive keys or user data. Use `vaultService` for encryption.

## 5. Coding Standards (TypeScript)
- Strict typing is mandatory. Avoid `any`.
- IPC: All `ipcMain.handle` must return a standard `{ success, data, error }` response.
- Service singletons: Initialize services clearly in `orchestratorService.ts` or `main.ts`.

## 6. Proactivity & Memory
- Use `memoryService` and `memorySearchService` for long-term fact storage (FTS5).
- Proactive suggestions must be filtered by the `proactivityEngine` to avoid user interruptions.
