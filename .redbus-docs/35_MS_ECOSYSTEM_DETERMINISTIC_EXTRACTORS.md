# 35. MS Ecosystem — Deterministic Extractors

## Objetivo

Extrair mensagens não lidas do **Outlook 365**, **Teams V2** e **WhatsApp Web** de forma 100% determinística, sem envolver LLMs na navegação. O LLM é utilizado apenas para classificação de urgência após a extração.

## Estratégia de Seletores

> **Regra de Ouro:** Zero classes CSS. Somente `aria-label`, `data-testid`, `data-tid`, e `role`.

A Microsoft e o WhatsApp geram nomes de classes CSS dinamicamente (Fluent UI v2, React). Esses nomes mudam entre releases e não são confiáveis para automação.

### Outlook 365 (`outlook.office365.com`)

| Seletor | Elemento |
|---|---|
| `[role="option"]` | Item de email na caixa de entrada |
| `[role="listitem"]` | Fallback para item de email |
| `[data-testid*="MailListItem"]` | Fallback via data-testid |
| `aria-label` contendo "Unread" | Indica email não lido |

**Parsing do aria-label:** `"Sender, Subject, Unread, [Has attachment,] ReceivedTime, Preview"`

### Teams V2 (`teams.microsoft.com/v2/`)

| Seletor | Elemento |
|---|---|
| `[data-tid="chat-list-item"]` | Item de chat na sidebar |
| `[role="treeitem"]` | Fallback para item de chat |
| `[role="status"]`, `[data-tid*="badge"]` | Badge de mensagens não lidas |

### WhatsApp Web (`web.whatsapp.com`)

| Seletor | Elemento |
|---|---|
| `[aria-label="Chat list"]` | Container da lista de chats |
| `[data-testid="chat-list"]` | Fallback do container |
| `[role="listitem"]` | Linha de chat individual |
| `[data-testid="icon-unread-count"]` | Badge numérico de não lidos |

## Arquitetura

```
┌─────────────────┐
│ channelManager   │ → Gerencia BrowserViews (persist:outlook, persist:teams, persist:whatsapp)
│                  │ → Polling cada 10 min via setInterval
└────────┬────────┘
         │ executeJavaScript(extractorScript)
         ▼
┌─────────────────┐
│ extractors/      │ → outlook.ts, teams.ts, whatsapp.ts
│ (JS injection)   │ → Retorna UnifiedMessage[] em JSON
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ briefingEngine   │ → Envia JSON ao Worker LLM
│                  │ → Classifica urgência (low/medium/high)
│                  │ → Gera briefing textual + notificação OS
│                  │ → Gera rascunhos de resposta (opcional)
└─────────────────┘
```

## Sessões Isoladas

Cada canal usa uma partition separada do Electron:
- `persist:outlook` — cookies Microsoft 365
- `persist:teams` — cookies Microsoft Teams
- `persist:whatsapp` — sessão WhatsApp Web

As sessões sobrevivem restarts do app. O estado de conexão é persistido no `AppSettings`.

## Fluxo de Autenticação

Usa o **mesmo padrão** do Maestro (`browserManager.showViewForUserAuth`):

1. Usuário clica "Autenticar" na Inbox UI
2. `channelManager` cria `BrowserView` com a partition do canal (`persist:outlook`, etc.)
3. Carrega a URL do canal (ex: `outlook.office365.com/mail/`)
4. Mostra o `BrowserView` como painel flutuante **dentro da janela principal** do RedBus
5. Envia `auth-required` IPC → renderer desenha o frame vermelho + botão **"já loguei"**
6. Usuário faz login manualmente no painel (Microsoft, WhatsApp QR, etc.)
7. Ao clicar "já loguei", o IPC `browser:resume-auth` chama `resolveChannelAuth(channelId)`
8. O `BrowserView` é ocultado (bounds zero), mantido em memória como worker background
9. Polling de extração inicia automaticamente (a cada 10 min)

> **viewId format**: `inbox:outlook`, `inbox:teams`, `inbox:whatsapp` — o handler de `browser:resume-auth` roteia automaticamente para `resolveChannelAuth` quando o viewId começa com `inbox:`.

## Formato Unificado de Mensagem

```typescript
interface UnifiedMessage {
  channel: 'outlook' | 'teams' | 'whatsapp';
  sender: string;
  subject?: string;
  preview: string;
  timestamp?: string;
  urgency: 'unknown' | 'low' | 'medium' | 'high';
  isUnread: boolean;
}
```

## Resiliência

- 3 estratégias de fallback por extractor (role → data-testid → broader query)
- Multi-idioma: `unread`, `não lido`, `ungelesen`, `non lu`, etc.
- Cap de 30 mensagens por extractor
- Graceful degradation: se o LLM falha, retorna mensagens sem classificação

## Integração com o Maestro (Economia de Tokens)

Quando o usuário digita no chat algo como "loga no outlook", "conecta teams", "entra no zap", o sistema **NÃO** cria um spec de navegação nem gasta tokens de Worker.

### Camada 1 — Pre-LLM Interceptor (zero tokens)

Antes de chamar o LLM, `_tryInboxChannelIntercept` usa regex para detectar padrões de login:
- PT: `logar`, `entrar`, `conectar`, `acessar`, `autenticar`
- EN: `login`, `sign in`
- Canais: `outlook`, `hotmail`, `office 365`, `teams`, `whatsapp`, `wpp`, `zap`

Se detectado → `authenticateChannel` é chamado diretamente. **Zero tokens consumidos.**

### Camada 2 — FORMAT I (fallback via Maestro)

Se o interceptor não detectar (fraseamento complexo), o Maestro tem `FORMAT I` no system prompt:
```json
{ "connect_inbox_channel": "outlook" | "teams" | "whatsapp" }
```
O handler no orchestrator chama `authenticateChannel`. **Gasta tokens de Maestro, mas zero de Worker.**
