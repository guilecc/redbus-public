/**
 * fetch with configurable timeout via AbortController.
 * Default: 120s — generous for large LLM prompts (email bodies, DOM dumps).
 */
import { getLanguagePromptDirective } from '../database';
import { logActivity } from './activityLogger';

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 120_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs / 1000}s — the model may be overloaded or the prompt too large.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function extractDataFromDOM(db: any, domText: string, instruction: string): Promise<string> {
  const configs = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
  if (!configs) throw new Error('Provider configs not found');

  const workerModel = configs.workerModel || 'gemini-2.5-flash';
  logActivity('orchestrator', `[Worker/Vision] Extraindo dados com ${workerModel}`);

  // Buscar Alma / Identidade do RedBus
  let userProfileStr = '';
  try {
    const profile = db.prepare("SELECT system_prompt_compiled FROM UserProfile WHERE id = 'default'").get();
    if (profile && profile.system_prompt_compiled) {
      userProfileStr = `\n--- USER PROFILE CONTEXT ---\n${profile.system_prompt_compiled}\n---------------------------\n`;
    }
  } catch (e) { /* ignore */ }
  userProfileStr += getLanguagePromptDirective(db);

  // Guard: if DOM text is too short or clearly not real content, return empty
  const trimmedDom = (domText || '').trim();
  if (trimmedDom.length < 50) {
    console.warn(`[extractDataFromDOM] DOM text too short (${trimmedDom.length} chars), returning NO_DATA`);
    return JSON.stringify({ status: 'NO_DATA_FOUND', reason: 'Page content was empty or too short to extract meaningful data.' });
  }

  // Create the instruction prompt forcing JSON
  const systemPrompt = `You are a strict data extraction worker. ${userProfileStr}
Follow the user instruction to extract data from the provided DOM text.
You MUST reply with ONLY a valid JSON object. No markdown wrapping, no extra text, just the raw JSON.

CRITICAL RULES:
- ONLY extract data that is ACTUALLY PRESENT in the DOM text below.
- If the DOM text does not contain the requested information, return: {"status": "NO_DATA_FOUND", "reason": "description of what was found instead"}
- NEVER invent, fabricate, or hallucinate data. If you cannot find emails, names, dates, or any specific content in the DOM, say so.
- If the page appears to be a login page, error page, or loading screen, return: {"status": "NO_DATA_FOUND", "reason": "Page is a login/error/loading screen"}`;

  const userPrompt = `Instruction: ${instruction}\n\nDOM Content:\n${trimmedDom.substring(0, 40000)}`;

  // Ollama
  if (workerModel.startsWith('ollama/')) {
    const targetUrl = configs.ollamaUrl || 'http://localhost:11434';
    const cleanModel = workerModel.replace('ollama/', '');
    const response = await fetchWithTimeout(`${targetUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: cleanModel,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`Ollama API Error: ${await response.text()}`);
    const data = await response.json();
    return data.choices[0].message.content;
  }

  // Ollama
  if (workerModel.startsWith('ollama/')) {
    const targetUrl = configs.ollamaUrl || 'http://localhost:11434';
    const cleanModel = workerModel.replace('ollama/', '');
    const response = await fetchWithTimeout(`${targetUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: cleanModel,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`Ollama API Error: ${await response.text()}`);
    const data = await response.json();
    return data.choices[0].message.content;
  }

  // Google Gemini
  if (workerModel.includes('gemini')) {
    if (!configs.googleKey) throw new Error('Google API Key is missing for worker');

    // We use standard fetch for LLM Agnostic REST call
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${workerModel}:generateContent?key=${configs.googleKey}`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) throw new Error(`Google API API Error: ${await response.text()}`);
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }

  // Anthropic Claude
  if (workerModel.includes('claude')) {
    if (!configs.anthropicKey) throw new Error('Anthropic API Key is missing for worker');

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': configs.anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: workerModel,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) throw new Error(`Anthropic API Error: ${await response.text()}`);
    const data = await response.json();
    // Usually Anthropic returns text block. If it wrapped in markdown we might need to clean it but prompt tries to avoid it.
    let text = data.content[0].text.trim();
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    return text;
  }

  // OpenAI GPT
  if (workerModel.includes('gpt')) {
    if (!configs.openAiKey) throw new Error('OpenAI API Key is missing for worker');

    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${configs.openAiKey}`
      },
      body: JSON.stringify({
        model: workerModel,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) throw new Error(`OpenAI API Error: ${await response.text()}`);
    const data = await response.json();
    return data.choices[0].message.content;
  }

  throw new Error(`Unsupported generic worker model: ${workerModel}`);
}

/**
 * Call the worker LLM with a raw prompt (no JSON mode forced).
 * Used for digest generation and channel content interpretation.
 */
export async function callWorkerRaw(db: any, systemPrompt: string, userPrompt: string): Promise<string> {
  const configs = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
  if (!configs) throw new Error('Provider configs not found');

  const workerModel = configs.workerModel || 'gemini-2.5-flash';
  logActivity('orchestrator', `[Worker/Raw] Executando análise com ${workerModel}`);

  // Ollama
  if (workerModel.startsWith('ollama/')) {
    const targetUrl = configs.ollamaUrl || 'http://localhost:11434';
    const cleanModel = workerModel.replace('ollama/', '');
    const response = await fetchWithTimeout(`${targetUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cleanModel, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] })
    });
    if (!response.ok) throw new Error(`Ollama API Error: ${await response.text()}`);
    const data = await response.json();
    return data.choices[0].message.content;
  }

  if (workerModel.includes('gemini')) {
    if (!configs.googleKey) throw new Error('Google API Key is missing');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${workerModel}:generateContent?key=${configs.googleKey}`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
      })
    });
    if (!response.ok) throw new Error(`Google API Error: ${await response.text()}`);
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }

  if (workerModel.includes('claude')) {
    if (!configs.anthropicKey) throw new Error('Anthropic API Key is missing');
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': configs.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: workerModel, max_tokens: 4096, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] })
    });
    if (!response.ok) throw new Error(`Anthropic API Error: ${await response.text()}`);
    const data = await response.json();
    return data.content[0].text.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  if (workerModel.includes('gpt')) {
    if (!configs.openAiKey) throw new Error('OpenAI API Key is missing');
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${configs.openAiKey}` },
      body: JSON.stringify({ model: workerModel, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] })
    });
    if (!response.ok) throw new Error(`OpenAI API Error: ${await response.text()}`);
    const data = await response.json();
    return data.choices[0].message.content;
  }

  throw new Error(`Unsupported worker model: ${workerModel}`);
}

const WORKER_TOOLS = [
  {
    name: 'browser_snapshot',
    description: 'Takes a snapshot of the current page\'s Accessibility Tree. Returns a YAML-like tree showing all visible content and interactive elements with [ref=N] markers. Interactive elements can be targeted by their ref number using other tools. Call this to see the current state of the page.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'browser_click',
    description: 'Clicks an element identified by its ref number from browser_snapshot. Waits for the page to update and returns the new snapshot automatically.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref of the element to click, e.g. "e5" from browser_snapshot [ref=e5]' }
      },
      required: ['ref']
    }
  },
  {
    name: 'browser_type',
    description: 'Types text into an input/textarea/searchbox identified by its ref number. If submit is true, also presses Enter after typing (useful for search bars). Waits for the page to update and returns the new snapshot.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref of the input element, e.g. "e3"' },
        text: { type: 'string', description: 'The text to type' },
        submit: { type: 'boolean', description: 'If true, press Enter after typing (default: false)' }
      },
      required: ['ref', 'text']
    }
  },
  {
    name: 'browser_press_key',
    description: 'Presses a keyboard key on the currently focused element. Returns the new snapshot.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp' }
      },
      required: ['key']
    }
  },
  {
    name: 'browser_scroll_down',
    description: 'Scrolls the page down by ~2/3 of the viewport to reveal more content. Returns the new snapshot. Use this when you need to see content below the current view.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'browser_scroll_up',
    description: 'Scrolls the page up by ~2/3 of the viewport. Returns the new snapshot.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'request_user_authentication',
    description: 'AUTHENTICATION TOOL: Call this when the current page is a login/sign-in page. Opens the browser panel visually so the user can log in manually. Execution pauses until the user completes authentication. After this returns, the page will be authenticated and you get a fresh snapshot.',
    input_schema: {
      type: 'object',
      properties: {
        login_url_detected: { type: 'string', description: 'The login URL currently displayed' }
      },
      required: ['login_url_detected']
    }
  },
  {
    name: 'request_explicit_human_consent',
    description: 'HITL checkpoint. Pauses and asks the human operator for approval. Use when extraction returned empty or action may be blocked. Do NOT use for login pages — use request_user_authentication instead.',
    input_schema: {
      type: 'object',
      properties: {
        reason_for_consent: { type: 'string', description: 'Why you need human approval' },
        intended_action: { type: 'string', description: 'What you plan to do next if approved' }
      },
      required: ['reason_for_consent', 'intended_action']
    }
  },
  {
    name: 'commit_extracted_data',
    description: 'Commits the final structured data and terminates the task. Call this when you have gathered all requested information from the page.',
    input_schema: {
      type: 'object',
      properties: {
        data: { type: 'object', description: 'The structured data extracted' }
      },
      required: ['data']
    }
  },
  // ── Forge Tools ──
  {
    name: 'forge_write_snippet',
    description: 'Saves a reusable code snippet to the local vault. Use this to persist scripts, templates, or code fragments that can be reused across tasks.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Unique name for the snippet (e.g. "parse_outlook_emails")' },
        language: { type: 'string', description: 'Programming language: python, typescript, bash, sql, javascript' },
        code: { type: 'string', description: 'The code content' },
        description: { type: 'string', description: 'What this snippet does' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' }
      },
      required: ['name', 'language', 'code']
    }
  },
  {
    name: 'forge_read_snippet',
    description: 'Reads a previously saved code snippet from the local vault by name.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the snippet to read' }
      },
      required: ['name']
    }
  },
  {
    name: 'forge_list_snippets',
    description: 'Lists saved code snippets, optionally filtered by language or tag.',
    input_schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Filter by language (python, bash, etc)' },
        tag: { type: 'string', description: 'Filter by tag' }
      }
    }
  },
  {
    name: 'forge_exec',
    description: 'Executes a shell command in a sandboxed environment. Returns stdout, stderr, exit code and duration. Max 30s timeout. Dangerous commands (sudo, rm -rf) will be blocked and require human approval.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute (e.g. "python3 -c \'print(1+1)\'")' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (max 30000, default 30000)' }
      },
      required: ['command']
    }
  }
];

export async function runWorkerStep(db: any, messages: any[]): Promise<any> {
  const configs = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
  const workerModel = configs.workerModel || 'gemini-2.5-flash'; // Fallback to a known model
  logActivity('orchestrator', `[Worker/Step] Ferramenta (loop) via ${workerModel}`);

  // Get UserProfile for RedBus Identity
  let userProfileStr = '';
  try {
    const profile = db.prepare("SELECT system_prompt_compiled FROM UserProfile WHERE id = 'default'").get();
    if (profile && profile.system_prompt_compiled) {
      userProfileStr = `\n--- USER PROFILE CONTEXT ---\n${profile.system_prompt_compiled}\n---------------------------\n`;
    }
  } catch (e) { /* ignore */ }
  userProfileStr += getLanguagePromptDirective(db);

  const systemMessage = `You are a local DOM Worker agent embedded in the REDBUS desktop application. ${userProfileStr}
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
- forge_write_snippet(name, language, code): Saves a reusable code snippet to the local vault.
- forge_read_snippet(name): Reads a saved snippet by name.
- forge_list_snippets(language?, tag?): Lists saved snippets.
- forge_exec(command): Executes a shell command in a sandboxed environment. Max 30s.

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

  // Ollama
  if (workerModel.startsWith('ollama/')) {
    const targetUrl = configs.ollamaUrl || 'http://localhost:11434';
    const cleanModel = workerModel.replace('ollama/', '');

    const openAiTools = WORKER_TOOLS.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));

    const response = await fetchWithTimeout(`${targetUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: cleanModel,
        messages: [{ role: 'system', content: systemMessage }, ...messages],
        tools: openAiTools
      })
    });

    if (!response.ok) throw new Error(`Ollama API Error: ${await response.text()}`);
    const data = await response.json();
    const message = data.choices[0].message;

    if (message.tool_calls) {
      return {
        tool_calls: message.tool_calls.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
        }))
      };
    }
    return { content: message.content };
  }

  if (workerModel.includes('gemini')) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${workerModel}:generateContent?key=${configs.googleKey}`;

    // Convert tools for Gemini
    const geminiTools = [{
      function_declarations: WORKER_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }))
    }];

    // Convert messages for Gemini
    const geminiContents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }]
    }));

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemMessage }] },
        contents: geminiContents,
        tools: geminiTools
      })
    });

    if (!response.ok) throw new Error(`Gemini API Error: ${await response.text()}`);
    const data = await response.json();
    const part = data.candidates[0].content.parts[0];

    if (part.functionCall) {
      return { tool_calls: [{ name: part.functionCall.name, args: part.functionCall.args }] };
    }
    return { content: part.text };
  }

  if (workerModel.includes('claude')) {
    const anthropicTools = WORKER_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema
    }));

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': configs.anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: workerModel,
        max_tokens: 4096,
        system: systemMessage,
        messages: messages,
        tools: anthropicTools
      })
    });

    if (!response.ok) throw new Error(`Anthropic API Error: ${await response.text()}`);
    const data = await response.json();

    const toolCalls = data.content.filter((c: any) => c.type === 'tool_use').map((c: any) => ({
      id: c.id,
      name: c.name,
      args: c.input
    }));

    if (toolCalls.length > 0) return { tool_calls: toolCalls };
    return { content: data.content[0].text };
  }

  if (workerModel.includes('gpt')) {
    const openAiTools = WORKER_TOOLS.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));

    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${configs.openAiKey}`
      },
      body: JSON.stringify({
        model: workerModel,
        messages: [{ role: 'system', content: systemMessage }, ...messages],
        tools: openAiTools
      })
    });

    if (!response.ok) throw new Error(`OpenAI API Error: ${await response.text()}`);
    const data = await response.json();
    const message = data.choices[0].message;

    if (message.tool_calls) {
      return {
        tool_calls: message.tool_calls.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments)
        }))
      };
    }
    return { content: message.content };
  }

  throw new Error(`Unsupported model for tool calling: ${workerModel}`);
}
