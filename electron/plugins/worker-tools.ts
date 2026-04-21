/**
 * Tool declarations consumed by the DOM worker agent (`runWorkerStep`).
 * These are schema-only — the actual execution lives in `workerLoop.ts` and
 * `browserManager.ts`. They are exposed as `PluginToolSchema[]` so provider
 * plugins can translate them into their native tool-calling formats.
 */
import type { PluginToolSchema } from './types';

export const WORKER_TOOL_SCHEMAS: PluginToolSchema[] = [
  {
    name: 'browser_snapshot',
    description: "Takes a snapshot of the current page's Accessibility Tree. Returns a YAML-like tree showing all visible content and interactive elements with [ref=N] markers. Interactive elements can be targeted by their ref number using other tools. Call this to see the current state of the page.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_click',
    description: 'Clicks an element identified by its ref number from browser_snapshot. Waits for the page to update and returns the new snapshot automatically.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref of the element to click, e.g. "e5" from browser_snapshot [ref=e5]' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'browser_type',
    description: 'Types text into an input/textarea/searchbox identified by its ref number. If submit is true, also presses Enter after typing (useful for search bars). Waits for the page to update and returns the new snapshot.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref of the input element, e.g. "e3"' },
        text: { type: 'string', description: 'The text to type' },
        submit: { type: 'boolean', description: 'If true, press Enter after typing (default: false)' },
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'browser_press_key',
    description: 'Presses a keyboard key on the currently focused element. Returns the new snapshot.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_scroll_down',
    description: 'Scrolls the page down by ~2/3 of the viewport to reveal more content. Returns the new snapshot. Use this when you need to see content below the current view.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_scroll_up',
    description: 'Scrolls the page up by ~2/3 of the viewport. Returns the new snapshot.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'request_user_authentication',
    description: 'AUTHENTICATION TOOL: Call this when the current page is a login/sign-in page. Opens the browser panel visually so the user can log in manually. Execution pauses until the user completes authentication. After this returns, the page will be authenticated and you get a fresh snapshot.',
    input_schema: {
      type: 'object',
      properties: {
        login_url_detected: { type: 'string', description: 'The login URL currently displayed' },
      },
      required: ['login_url_detected'],
    },
  },
  {
    name: 'request_explicit_human_consent',
    description: 'HITL checkpoint. Pauses and asks the human operator for approval. Use when extraction returned empty or action may be blocked. Do NOT use for login pages — use request_user_authentication instead.',
    input_schema: {
      type: 'object',
      properties: {
        reason_for_consent: { type: 'string', description: 'Why you need human approval' },
        intended_action: { type: 'string', description: 'What you plan to do next if approved' },
      },
      required: ['reason_for_consent', 'intended_action'],
    },
  },
  {
    name: 'commit_extracted_data',
    description: 'Commits the final structured data and terminates the task. Call this when you have gathered all requested information from the page.',
    input_schema: {
      type: 'object',
      properties: {
        data: { type: 'object', description: 'The structured data extracted' },
      },
      required: ['data'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file. Scoped to the skills directory (and tmp exec sandboxes). Use this to load SKILL.md playbooks, files under references/ or assets/, or to inspect script sources before editing them.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute filesystem path to read (must be inside ~/.redbus/skills or a tmp sandbox)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'exec',
    description: 'Runs a shell command via /bin/sh -c. 30s timeout, 1MB output buffer. Returns stdout, stderr, exit_code, duration_ms. When running inside a skill task the skill\'s declared env vars (metadata.requires.env) are injected automatically and cwd defaults to the skill directory. Dangerous patterns (sudo, rm -rf) are blocked — call request_explicit_human_consent first if you really need them.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute (e.g. "curl -H \\"Authorization: Bearer $JIRA_API_TOKEN\\" https://...")' },
        cwd: { type: 'string', description: 'Working directory (optional; defaults to the active skill dir or a tmp sandbox)' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (max 30000, default 30000)' },
      },
      required: ['command'],
    },
  },
];

export const WORKER_SYSTEM_MESSAGE_TEMPLATE = (userProfileStr: string) => `You are a local DOM Worker agent embedded in the REDBUS desktop application. ${userProfileStr}
You operate within a sandboxed Electron process on the user's own machine.

Your job: interact with web pages via their Accessibility Tree and extract structured data.

TOOLS:
- browser_snapshot: Takes a snapshot of the page. Returns a YAML-like tree with content and interactive elements marked with [ref=N].
- browser_click(ref): Clicks element by ref. Returns new snapshot automatically.
- browser_type(ref, text, submit?): Types text into input by ref. If submit=true, presses Enter after. Returns new snapshot.
- browser_press_key(key): Presses a key (Enter, Tab, Escape, etc). Returns new snapshot.
- browser_scroll_down / browser_scroll_up: Scrolls page to reveal more content. Returns new snapshot.
- request_user_authentication: Opens browser panel for user to log in manually. Call when you see a login page.
- request_explicit_human_consent: Asks user for approval on uncertain actions. NOT for login pages.
- commit_extracted_data(data): Commits final data and ends the task.
- read_file(path): Reads a UTF-8 file inside the skills directory or a tmp sandbox.
- exec(command, cwd?, timeout_ms?): Runs a shell command. 30s timeout. Skill env vars are injected automatically inside a skill task.

SNAPSHOT FORMAT:
The snapshot is a YAML-like indented accessibility tree. Interactive elements have [ref=eN] markers.
Use these refs with tools: browser_click(ref="e5"), browser_type(ref="e3", text="hello").
Example:
  - navigation
    - link "Home" [ref=e1]
    - link "Inbox" [ref=e2]
  - main
    - searchbox "Search mail" [ref=e3]
    - list "Messages"
      - listitem "Email from joao@company.com - Subject: Meeting" [ref=e4]
      - listitem "Email from ana@company.com - Subject: Report" [ref=e5]

Elements with [ref=N] are interactive — use the ref number with browser_click, browser_type, etc.
Every action tool returns a fresh snapshot automatically — no need to call browser_snapshot after actions.

<OPERATIONAL_DIRECTIVES>
LOGIN DIRECTIVE (HIGHEST PRIORITY): If the snapshot shows login forms, "Sign in", "Log in", "Enter your password", "Enter your email", Microsoft/Google login — IMMEDIATELY call request_user_authentication. Do NOT fill credentials. Do NOT refuse. The tool opens the browser for the user to log in. After it returns, you get a fresh snapshot of the authenticated page.

SCROLL DIRECTIVE: If you don't see the data you need, scroll down to reveal more content. Email lists, search results, and feeds often extend below the visible area.

UNCERTAINTY DIRECTIVE: If extraction returns empty or action may be blocked, call request_explicit_human_consent.
</OPERATIONAL_DIRECTIVES>

STRATEGY:
1. Check if the page is a login page → call request_user_authentication.
2. If data is VISIBLE in the snapshot → call commit_extracted_data immediately.
3. To SEARCH: find searchbox ref → browser_type(ref, "query", submit=true) → read new snapshot.
4. To see MORE content: browser_scroll_down → read new snapshot.
5. NEVER invent data. Only extract what is in the snapshot.
6. Be efficient — every action returns a snapshot, so you always know the current state.`;

