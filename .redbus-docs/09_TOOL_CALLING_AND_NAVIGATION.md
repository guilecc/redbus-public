# 09. TOOL CALLING & WEB NAVIGATION

## Worker LLM Tool-Use
O Worker (modelo rápido, ex: Gemini Flash) opera via `runWorkerStep` em `llmService.ts`. Recebe histórico de mensagens e retorna ou texto ou `tool_calls`.

### System Prompt do Worker
Define 8 tools com schema JSON:
- `browser_snapshot` — sem parâmetros
- `browser_click` — `{ref: number}`
- `browser_type` — `{ref: number, text: string, submit?: boolean}`
- `browser_press_key` — `{key: string}` (Enter, Tab, Escape, etc.)
- `browser_scroll_down` / `browser_scroll_up` — sem parâmetros
- `request_user_authentication` — `{login_url_detected: string}`
- `request_explicit_human_consent` — `{reason_for_consent, intended_action}`
- `commit_extracted_data` — `{data: any}`

Forge tools adicionais (criados dinamicamente):
- `forge_write_snippet`, `forge_read_snippet`, `forge_list_snippets`, `forge_exec`

### Estratégia de Navegação
O Maestro instrui o Worker a usar busca nativa dos sites (ex: barra de pesquisa do Outlook/Jira/Gmail) em vez de tentar ler toda a página inicial. Steps exemplo:
1. Click na search bar
2. Type query
3. Press Enter
4. Extract dados filtrados

### Snapshot Unificado
Cada tool de ação (click, type, key, scroll) retorna automaticamente um novo snapshot da página, eliminando a necessidade de chamar `browser_snapshot` separadamente.

## DOM Extraction (llmService.ts)
`extractDataFromDOM(db, domText, instruction)` — Usado pelo schedulerService para extrair dados de páginas carregadas em BrowserViews ocultas. Envia DOM text + instrução ao Worker LLM, que retorna JSON puro.

Guard: DOM < 50 chars → retorna `NO_DATA_FOUND`.

