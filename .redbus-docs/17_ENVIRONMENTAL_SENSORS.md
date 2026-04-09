# 17. ENVIRONMENTAL SENSORS

## SensorManager (sensorManager.ts)
Gere 5 sensores ambientais que alimentam o contexto do Maestro. Cada sensor pode ser ligado/desligado independentemente. Estado persiste em AppSettings.

### 5 Sensores
| Sensor | ID | Fonte | Intervalo |
|--------|-----|-------|-----------|
| Clipboard | `clipboard` | `clipboard.readText()` | 3s |
| Active Window | `activeWindow` | JXA osascript | 3s |
| Vision (OCR) | `vision` | screenshot → ocrWorker | 30s |
| Accessibility | `accessibility` | accessibilitySensor (JXA AX tree) | 5s |
| Microphone | `microphone` | audioAdapterService | sob demanda |

### Clipboard Sensor
- Poll cada 3s via `clipboard.readText()`
- Compara hash MD5 com último lido
- Se mudou: atualiza estado, emite `sensor:clipboard-updated`
- Ignora conteúdo > 5000 chars

### Active Window Sensor
- Poll cada 3s via JXA (`osascript -e`)
- Captura: app name, window title
- Se mudou: atualiza estado, emite `sensor:active-window-updated`
- Usado pelo ProactivityEngine para contexto

### Vision Sensor (OCR)
- Poll cada 30s (apenas se ligado)
- Captura screenshot via `screenshot-desktop`
- Passa ao `ocrWorker` (tesseract.js) → texto
- Salva em ScreenMemory com dedup por `text_hash` (SHA-256)
- Emite `sensor:vision-captured`

### Accessibility Sensor
- Poll cada 5s
- Usa `accessibilitySensor.ts` (JXA macOS AX API)
- Captura árvore de acessibilidade da app ativa
- Recursão até profundidade 4, máx 200 elementos
- Emite `sensor:accessibility-updated`

### Microphone Sensor
- Não faz poll automático
- Ativado sob demanda via UI widget
- Controla gravação de áudio para meetings

### Persistência de Toggle
- `getPersistedSensorToggles()` / `persistSensorToggle()` via AppSettings
- Key: `sensor_<id>_enabled`, value: 'true'/'false'
- Defaults: clipboard=true, activeWindow=true, vision=false, accessibility=false, microphone=false

### IPC
- `sensor:get-statuses` → retorna estado de todos os 5 sensores
- `sensor:toggle` → liga/desliga sensor + persiste
- `sensor:get-env-context` → retorna contexto agregado (clipboard, window, vision, AX)



## Activity Console
Todos os eventos de sensores são emitidos para o **Activity Console** (`activityLogger.logActivity()`), permitindo monitoramento em tempo real. Ver [22_ACTIVITY_CONSOLE.md](./22_ACTIVITY_CONSOLE.md) para detalhes completos da arquitetura de logs.