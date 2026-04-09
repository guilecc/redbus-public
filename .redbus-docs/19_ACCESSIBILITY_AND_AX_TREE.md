# 19. ACCESSIBILITY TREE & NATIVE WINDOW READING

## accessibilitySensor.ts
Lê a árvore de acessibilidade nativa do macOS via JXA (JavaScript for Automation) e AppleScript bridge.

### Captura da Árvore
`captureAccessibilityTree()`:
1. Identifica app ativa via `Application('System Events').processes.whose({frontmost: true})`
2. Recursivamente percorre `uiElements` da janela principal
3. Para cada elemento captura: `role`, `title`, `value`, `description`, `focused`, `subrole`, `position`, `size`
4. Limites: profundidade máx 4, máx 200 elementos
5. Retorna JSON string da árvore completa

### Aplicações-Alvo
Funciona com qualquer aplicação nativa macOS que exponha AX API:
- Chrome, Safari, Firefox
- VS Code, Xcode
- Finder, Mail, Calendar
- Slack, Discord, etc.

### Uso pelo Agente
- **FORMAT G** do Maestro: "Read Native Window Tree"
- O Maestro pode pedir para ler o que está visível em apps nativas
- Útil para contexto: saber o que o utilizador está a ver/fazer
- Alimenta o Tier 5 do context builder

### Integração com SensorManager
- Sensor `accessibility`: poll cada 5s
- Se árvore mudou: atualiza estado, emite `sensor:accessibility-updated`
- Usado pelo ProactivityEngine para detectar mudanças no contexto visual

### Requisitos macOS
- Necessita permissão "Accessibility" em System Preferences → Privacy
- Sem permissão: retorna erro capturado silenciosamente

