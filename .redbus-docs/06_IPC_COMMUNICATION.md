# 06. IPC COMMUNICATION

## Bridge (preload.ts → window.redbusAPI)
O `preload.ts` expõe `window.redbusAPI` via `contextBridge.exposeInMainWorld`. Todos os métodos usam `ipcRenderer.invoke` (request/response) ou `ipcRenderer.on` (events push).

## Handlers IPC Implementados (ipcHandlers.ts)

### Configuração
- `provider:get-configs` → lê ProviderConfigs
- `provider:save-configs` → salva API keys + modelos
- `provider:fetch-models` → lista modelos disponíveis de cada provider

### Orquestração
- `spec:create-from-prompt` → Maestro cria spec (FORMAT A-H)
- `spec:execute` → executa browser spec via workerLoop
- `spec:execute-python` → executa Python spec via pythonExecutor

### Mensagens
- `messages:save` → persiste mensagem no ChatMessages
- `messages:get` → lê últimas N mensagens (limit, offset)

### Vault
- `vault:save-secret` → cifra e salva token
- `vault:list-secrets` → lista service_names (sem tokens)
- `vault:delete-secret` → remove token

### Perfil / Alma
- `user:get-profile` → lê UserProfile

### Arquivos
- `archive:list` → lista ficheiros .sqlite de arquivo
- `archive:delete` → apaga ficheiro de arquivo

### Rotinas
- `routine:list` → lista LivingSpecs com cron
- `routine:toggle` → ativa/desativa rotina
- `routine:delete` → remove rotina
- `routine:run-now` → execução manual imediata
- `routine:get-executions` → log de execuções

### Skills / Forge
- `forge:list-snippets` → lista ForgeSnippets
- `forge:read-snippet` → lê snippet por nome
- `forge:write-snippet` → cria/atualiza snippet
- `forge:delete-snippet` → remove snippet

### Sensores
- `sensor:get-statuses` → estado dos 5 sensores
- `sensor:toggle` → liga/desliga sensor
- `sensor:get-env-context` → contexto ambiental atual

### Proatividade
- `proactivity:get-level` → nível atual
- `proactivity:set-level` → altera nível (OFF/LOW/MEDIUM/HIGH)
- `proactivity:get-timings` → timings por nível
- `proactivity:set-timing` → altera intervalo/cooldown de um nível
- `proactivity:force-eval` → força avaliação imediata
- `proactivity:get-status` → estado completo do engine

### Áudio
- `audio:process` → processa buffer de áudio (FULL_CLOUD)
- `audio:process-hybrid` → transcrição local + NLP cloud
- `audio:get-meeting-memory` → lista reuniões salvas

### AppSettings
- `app:get-setting` → lê setting
- `app:set-setting` → salva setting

### Auth
- `browser:resume-auth` → resolve gate de autenticação

### Sistema
- `system:factory-reset` → wipe total (preserva API keys)

### HITL
- `hitl:respond` → responde a pedido de consentimento humano

## Events Push (main → renderer)
- `worker:step-updated` → progresso de execução de step
- `auth-required` → BrowserView precisa de login
- `auth-completed` → login concluído
- `hitl-consent-request` → pedido de aprovação humana
- `chat:new-message` → mensagem proativa do engine
- `sensor:clipboard-updated` → novo conteúdo clipboard
- `sensor:active-window-updated` → mudança de janela ativa
- `sensor:vision-captured` → OCR capturado
- `sensor:accessibility-updated` → árvore AX atualizada
- `meeting:review-ready` → ata pronta para revisão

