# 10. UI/UX & CHAT INTERFACE

## Estrutura da UI (App.tsx)
A App é uma SPA com routing via `activeView` state:

| View | Componente | Descrição |
|------|-----------|-----------|
| `chat` | MessageList + ChatInput | Chat principal com o agente |
| `history` | inline | Lista de arquivos .sqlite exportados |
| `skills` | SkillManager | CRUD de ForgeSnippets |
| `routines` | RoutineManager | Gestão de rotinas cron |
| `settings` | inline (5 tabs) | Configurações |
| `meetings` | MeetingsView | Lista unificada de reuniões (tl;dv + local) |
| `meeting-review` | MeetingReview | Revisão de ata de reunião |

## Widget Window
Hash routing: se `window.location.hash` contém `/widget`, renderiza `WidgetOverlay` em vez da app principal. Janela flutuante separada para controle de gravação de áudio.

## Settings (5 Tabs)
1. **LLM & Modelos** — API keys (OpenAI, Anthropic, Google) com validação + seleção Maestro/Worker
2. **Cofre** — CRUD de tokens SecureVault
3. **Áudio** — Dispositivos mic/sistema, modo transcrição (FULL_CLOUD/HYBRID_LOCAL), motor cloud
4. **Proatividade** — Nível (OFF/LOW/MEDIUM/HIGH) + timings por nível
5. **Sistema** — Retenção de dados, cleanup manual, factory reset

## Mensagens
Tipos de mensagem no chat:
- `user` / `assistant` — mensagens normais
- `spec` — Living Spec com AgentTaskProgress (steps com status pending/running/completed/failed)
- `proactive` — mensagem gerada pelo ProactivityEngine
- `thinking` — interno, filtrado do display (nunca mostrado ao utilizador)

## Onboarding
Se UserProfile não existe (id='default'), mostra mensagem inicial pedindo ao utilizador para se apresentar. Fluxo de entrevista natural via JSON com `onboarding_reply` e `finalize_soul_setup`.

## Auth Modal
Quando `auth-required` é recebido, mostra BrowserView com frame vermelho e botão "já loguei". Auto-dismiss via `auth-completed`.

## HITL Consent Modal
Quando `hitl-consent-request` é recebido, mostra modal com razão e ação, botões Aprovar/Rejeitar.

## Factory Reset
Pede confirmação com texto "RESETAR". Chama `factoryReset(db, userDataPath)` que limpa todas as tabelas exceto ProviderConfigs (API keys preservadas).

