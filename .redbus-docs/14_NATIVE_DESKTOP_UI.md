# 14. NATIVE DESKTOP UI

## Electron Window (main.ts)
- `BrowserWindow` com `frame: false` (custom title bar)
- Dimensões: 480x780 mínimo, 480x780 padrão
- Vibrancy: `sidebar` (macOS)
- Background transparente
- `webPreferences`: nodeIntegration=false, contextIsolation=true, sandbox=false

## Custom TitleBar (TitleBar.tsx)
- `-webkit-app-region: drag` para arrastar janela
- Navegação: 5 views (Chat, Histórico, Skills, Rotinas, Configurações)
- "no-drag" nos botões de navegação

## System Tray (main.ts)
- Ícone tray persistente (`trayIcon.png`)
- Menu: "Abrir RedBus" + "Sair"
- Click no tray → mostra/foca janela
- Fechar janela → esconde (não termina app)
- `app.dock.hide()` + `skipTaskbar: true` → app corre em background

## Widget Window (Janela Flutuante)
- Segunda `BrowserWindow` independente, `alwaysOnTop: true`
- `400x80px`, sem frame, transparente
- Hash URL `/widget` para routing
- Usada para controle de gravação de reuniões
- IPC: `widget:toggle`, `widget:update-state`, `widget:close`

## Listeners de Lifecycle
- `window-all-closed` → mantém app viva (tray)
- `second-instance` → foca janela existente
- `activate` (macOS) → re-mostra janela se escondida

