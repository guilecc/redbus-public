# 25. ROUTINES UI & MANAGEMENT

## RoutineManager (React Component)
Interface para gestão visual de rotinas cron.

### Views
- **Lista** — Todas as rotinas com status, próxima execução, toggle on/off
- **RoutineCard** — Card individual com: nome, cron humanizado, status (active/paused/error), último resultado, botão "Run Now"
- **RoutinePipeline** — Timeline visual dos steps de execução
- **Log de Execuções** — Histórico de runs com status, duração, erros

### Ações IPC
| Ação | Handler |
|------|---------|
| Listar rotinas | `routine:list` |
| Toggle on/off | `routine:toggle` → atualiza `enabled` |
| Deletar | `routine:delete` |
| Executar agora | `routine:run-now` |
| Ver execuções | `routine:get-executions` |

### Cron Humanizado
Expressões cron são traduzidas para linguagem natural na UI (ex: "0 9 * * 1-5" → "Todos os dias úteis às 9h").

### Backoff Visual
Rotinas com erros consecutivos mostram indicador de backoff com tempo restante até próxima tentativa.

### Criação de Rotinas
Rotinas são criadas organicamente via chat — o utilizador pede ao agente e o Maestro gera um spec com `cron_expression`. Não há formulário de criação manual na UI.

