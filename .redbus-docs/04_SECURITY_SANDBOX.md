# 04. SECURITY & SANDBOX

## Modelo de Segurança
O RedBus opera como agente local — equivalente a uma extensão de browser ou script de automação Electron. O utilizador instala a app, autentica-se manualmente e delega tarefas ao agente.

## Isolamento de Processos
- **Main Process**: Acesso total a Node.js, SQLite, filesystem, rede.
- **Renderer Process**: Sandbox — sem acesso a Node.js. Comunica via `window.redbusAPI` (contextBridge).
- **BrowserViews**: `nodeIntegration: false`, `contextIsolation: true`, partição persistente `persist:redbus`.

## Zero Senhas
- Nenhuma senha é armazenada em BD.
- Autenticação acontece em BrowserViews visíveis ao utilizador.
- Sessão persiste via cookies na partição `persist:redbus`.
- Worker pode chamar `request_user_authentication` para mostrar BrowserView ao utilizador.

## SecureVault (Cofre de Tokens)
- Tabela `SecureVault`: id, service_name, encrypted_token.
- Tokens cifrados via `safeStorage.encryptString()` do Electron (usa Keychain no macOS).
- Injetados como variáveis de ambiente `REDBUS_<SERVICE_NAME>` nos processos Python.
- Nunca expostos ao renderer.

## HITL (Human-In-The-Loop)
- Worker pode chamar `request_explicit_human_consent` com razão e ação.
- Frontend mostra modal de aprovação/rejeição.
- Timeout de 120s → auto-DENIED.
- Comandos perigosos em `forge_exec` são bloqueados (`isDangerousCommand`) até aprovação humana.

## Anti-Refusal do LLM
O system prompt do Maestro contém `SECURITY_AND_AUTHORIZATION_CLEARANCE` que reforça que o agente opera localmente com autorização total do utilizador, prevenindo recusas falsas de LLMs.

