# Skill Library & Forge Rules (Python Execution)

## 1. Skill Development (ForgeSnippets)
A "Skill" is a reusable Python snippet stored in the `ForgeSnippets` table.
- **Rules:** Each snippet must have a version, `use_count`, and a `status` (draft/active/deprecated).
- **Format:** Prefer self-contained Python scripts that can run via `pythonExecutor.ts`.
- **Security:** Do NOT allow raw file system writes outside of `/tmp/` unless explicitly requested.

## 2. Python Executor Environment
Python scripts run as a `child_process` from the Node.js main process.
- **Virtual Env:** Scripts should ideally run within a managed environment if dependencies are needed.
- **Vault Injection:** Sensitive keys (API keys, passwords) must be injected as environment variables (via `vaultService.ts`), not hardcoded.
- **Timeout:** Always set a execution timeout for Python processes (max 60 seconds).

## 3. Tool Interaction
Skills can interact with the host OS or the RedBus context.
- **Data Exchange:** Output should be JSON whenever possible for easy parsing by the `orchestratorService`.
- **Audit Log:** Every skill execution must be logged in `ForgeExecutions` with status, duration, and output.

## 4. Forge Lifecycle
- **Discovery:** New skills can be "forged" during a chat based on user needs.
- **Version Control:** If a skill UI updates its logic, increment its version in the database.
- **Documentation:** Every forge snippet must include a docstring describing its inputs, outputs, and purpose.
