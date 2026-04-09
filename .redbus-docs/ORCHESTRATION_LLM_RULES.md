# Orchestration & LLM Interaction Rules

## 1. Maestro-Worker Architecture
The "Maestro" is a high-level LLM planner (GPT-4o, Claude 3.5 Sonnet) that handles complex reasoning and formatting.
The "Worker" is a faster LLM (GPT-4o-mini, Haiku) that executes low-level tool calls and DOM interactions.
- **Rules:** The Maestro produces a plan (JSON), and the Worker executes the specific tool calls.
- **Max Steps:** Any agentic loop (WorkerLoop) must be capped at 15 steps.

## 2. The 11 Strategic FORMATs (A-K)
The Maestro MUST output JSON matching one of these specific formats:
- **FORMAT A (Browser Spec):** Multi-step URL/Instruction navigation via Playwright.
- **FORMAT B (Python Execution):** One-off script for data processing or API calls.
- **FORMAT C (Conversational):** Simple text reply, no action.
- **FORMAT D (Execute Skill):** Run an existing snippet from the Forge.
- **FORMAT E (Forge Skill):** Create AND execute a new reusable Python tool.
- **FORMAT F (Screen Memory):** Search text in OCR history (Photographic Eye).
- **FORMAT G (Accessibility Tree):** Structural reading of native desktop app UI.
- **FORMAT H (Meeting Memory):** Search in local/tl;dv meeting recordings.
- **FORMAT I (Inbox Connect):** Specialized login for Outlook/Teams channels.
- **FORMAT J (Digest Memory):** Search in daily communication summaries.
- **FORMAT K (Parallel Tools):** Fire multiple native lookups (H + J) at once.

## 3. Mandatory Thinking Protocol
Every Maestro response MUST include a `thinking` field as the FIRST field. 
Structure for thinking:
1. **UNDERSTAND:** Restate user request.
2. **CONTEXT REVIEW:** Analyze messages, clipboard, active window, facts.
3. **CANDIDATES:** List possible FORMATs with pros/cons.
4. **DECISION:** Choose FORMAT and justify.
5. **SELF-CRITIQUE:** Check for ambiguity or misses.
6. **ANTI-PATTERN CHECK:** Ensure native tools (H, J, K) are used instead of skills for meeting/email search.

## 4. Native Tool Priority
NEVER create a Python skill (FORMAT E) or script (FORMAT B) for searching meetings or emails. 
- Use **FORMAT H** for meetings.
- Use **FORMAT J** for emails/digests.
- Use **FORMAT K** for combined searches.

## 5. Tool-Calling & Context
- **DOM Extraction:** Use `llmService.ts` to clean HTML before passing to LLM.
- **Compaction:** `archiveService.ts` manages rolling summaries.
- **MemoryFacts:** Store permanent key facts in `MemoryFacts` table via `memoryService.ts`.
