# 21. NATIVE NOTIFICATIONS

## notificationService.ts
Serviço de notificações nativas do OS usando `Notification` do Electron.

### API
- `notifyRoutineSuccess(title, body)` — notificação de sucesso de rotina
- `notifyRoutineError(title, body)` — notificação de erro de rotina
- `notifyProactiveInsight(body)` — notificação de insight proativo

### Comportamento
- Click na notificação → foca janela principal (`mainWindow.show()`)
- Usa ícone da app (`icon.png`)
- Silenciosa (sem som) para insights proativos

### Integração
- Chamado pelo `schedulerService` no final de cada execução cron
- Chamado pelo `proactivityEngine` quando decide intervir

