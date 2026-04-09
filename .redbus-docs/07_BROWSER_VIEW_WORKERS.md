# 07. BROWSER VIEW & WORKER LOOP

## BrowserManager (browserManager.ts)
Gere BrowserViews Electron para automação web. Todas usam sessão persistente `persist:redbus`.

### Tipos de View
1. **createHiddenBrowserView** — View oculta (0x0px), carrega URL, extrai texto do DOM. Usada pelo schedulerService para rotinas cron.
2. **createPersistentBrowserView** — View persistente, mantém-se viva para o workerLoop operar. Bloqueia popups redirecionando para a mesma view.
3. **navigateView** — Navega view existente para nova URL (reutiliza sessão/cookies).

### Accessibility Snapshot (SNAPSHOT_JS)
Script JS injetado que constrói árvore YAML do DOM:
- Cada nó mostra role ARIA + nome/label
- Elementos interactivos recebem `[ref=N]` via `data-redbus-id`
- Invisíveis, scripts, styles, SVGs são removidos
- Máximo ~20000 chars enviados ao LLM

### Estabilização SPA
`snapshotPage()` usa polling em 2 fases:
1. **Fase 1**: Espera conteúdo > 300 chars (até 4 tentativas, 2s cada)
2. **Fase 2**: Espera conteúdo estabilizar (diff < 100 chars, 2 consecutivas, até 6 tentativas)

### Ações DOM
- `clickElement(viewId, ref)` → click + 2s wait + novo snapshot
- `typeIntoElement(viewId, ref, text, submit)` → type + events (input/change) + opcional Enter
- `pressKey(viewId, key)` → keydown/keypress/keyup com keyCode map
- `scrollPage(viewId, 'up'|'down')` → scroll 66% viewport

### Auth Gate
- `showViewForUserAuth` — mostra view ao utilizador para login manual (com bounds calculados + border frame)
- `resolveAuth` — chamado quando utilizador clica "já loguei", resolve Promise, esconde view

## Worker Loop (workerLoop.ts)
Loop agentic tool-use com máximo de **15 steps**.

### Tools Disponíveis
| Tool | Ação |
|------|------|
| `browser_snapshot` | Captura snapshot da página |
| `browser_click` | Click por ref + retorna snapshot |
| `browser_type` | Type em input + opcional submit |
| `browser_press_key` | Pressiona tecla |
| `browser_scroll_down/up` | Scroll página |
| `request_user_authentication` | Mostra view para login manual |
| `request_explicit_human_consent` | HITL consent gate (120s timeout) |
| `commit_extracted_data` | Finaliza loop com dados extraídos |
| `forge_write_snippet` | Cria/atualiza snippet |
| `forge_read_snippet` | Lê snippet por nome |
| `forge_list_snippets` | Lista snippets |
| `forge_exec` | Executa comando shell (com guard isDangerousCommand) |

### Fluxo
1. Snapshot inicial da página
2. Loop: LLM analisa snapshot → chama tool → recebe resultado com novo snapshot
3. Termina quando `commit_extracted_data` ou max 15 steps

