# 22 — Activity Console (Console de Logs em Tempo Real)

## Visão Geral
O Activity Console é um painel flutuante que exibe logs de atividade do sistema em tempo real. Ele permite ao usuário monitorar todas as ações do RedBus — sensores, reuniões, rotinas, proatividade e orquestração — em uma interface leve e filtrada por categoria.

## Arquitetura

### Backend (`electron/services/activityLogger.ts`)
- **Buffer Circular em RAM**: mantém os últimos 500 eventos (performático, sem I/O).
- **Emissão IPC**: cada `logActivity()` envia `activity:log-entry` para o Renderer via `webContents.send()`.
- **Persistência SQLite** (opcional): logs marcados como `persist=true` são gravados na tabela `ActivityLog`.

### Tabela SQLite `ActivityLog`
```sql
CREATE TABLE IF NOT EXISTS ActivityLog (
  id TEXT PRIMARY KEY,
  timestamp DATETIME NOT NULL,
  category TEXT NOT NULL,    -- sensors | meetings | routines | proactivity | orchestrator
  message TEXT NOT NULL,
  metadata_json TEXT
);
```

### IPC Handlers (`electron/ipcHandlers.ts`)
| Canal | Direção | Descrição |
|---|---|---|
| `activity:get-recent-logs` | Renderer → Main | Retorna últimos N logs do buffer |
| `activity:clear-logs` | Renderer → Main | Limpa buffer em memória |
| `activity:log-entry` | Main → Renderer | Push de novo log em tempo real |

### Frontend (`src/components/ActivityConsole/ActivityConsole.tsx`)
- Painel flutuante fixo no canto inferior direito (400×300px)
- Toggle via botão Terminal na TitleBar
- Auto-scroll para último log
- Filtros por categoria (checkboxes)
- Limite de exibição: 100 logs (performance)

## Categorias de Logs e Cores

| Categoria | Cor | Hex |
|---|---|---|
| Sensors | Cyan | `#00d4ff` |
| Meetings | Laranja | `#ff6b35` |
| Routines | Turquesa | `#4ecdc4` |
| Proactivity | Amarelo | `#ffe66d` |
| Orchestrator | Azul Claro | `#a8dadc` |

## Eventos Logados por Serviço

### SensorManager (`electron/services/sensorManager.ts`)
- Sensor ligado/desligado (qualquer sensor)
- Clipboard: novo conteúdo capturado (chars + preview 50 chars)
- Active Window: mudança de janela ativa (app + título)
- Vision (OCR): screenshot capturado + chars extraídos
- Accessibility: árvore AX lida (app + nº de nós)

### tl;dv Sensor (`electron/services/sensors/tldvSensor.ts`)
- Sincronização concluída (nº reuniões novas)

### AudioAdapterService (`electron/services/audioAdapterService.ts`)
- Processamento de áudio iniciado (tamanho + engine)
- Reunião salva no banco (título + duração + provider) — **persiste no SQLite**

### SchedulerService (`electron/services/schedulerService.ts`)
- Rotina disparada (goal + specId)
- Rotina falhou (goal + erro + duração) — **persiste no SQLite**

### ProactivityEngine (`electron/services/proactivityEngine.ts`)
- Mudança de nível de proatividade (OFF/LOW/MEDIUM/HIGH)
- Sugestão proativa gerada (preview da mensagem)

### OrchestratorService (`electron/services/orchestratorService.ts`)
- Tarefa recebida do usuário (preview do prompt) — **persiste no SQLite**
- Living Spec criado (goal + specId) — **persiste no SQLite**

## Buffer Circular vs Persistência

| Aspecto | Buffer (RAM) | SQLite |
|---|---|---|
| Capacidade | 500 eventos | Ilimitado |
| Performance | O(1) push | I/O disk |
| Uso | Exibição no console | Auditoria/debug |
| Dados | Todos os logs | Apenas `persist=true` |
| Limpeza | `clearLogBuffer()` | Manual |

## Testes
- **Backend**: `test/activityLogger.test.ts` (10 testes)
- **Frontend**: `test/ActivityConsole.test.tsx` (7 testes)

