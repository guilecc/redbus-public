# Spec 11 — Communications Hub (Microsoft Graph API + Curadoria Manual)

**Alvo:** `electron/services/channelManager.ts`, `electron/services/extractors/**`, `electron/services/digestService.ts`, `src/components/Inbox/**`
**Objetivo:** Substituir totalmente a ingestão atual de Outlook/Teams — hoje baseada em Playwright + scraper dinâmico gerado por LLM (Spec 10) — por **chamadas diretas ao Microsoft Graph API**, e inserir entre a ingestão e o LLM de digest uma **camada de curadoria manual** onde o usuário inspeciona, filtra e seleciona itens antes de gastar tokens.

> **Premissa (ver `specs/README.md`):** nova versão do app. Sem migração de dados, sem retrocompat.

---

## 1. Motivação — por que abandonar Playwright + Spec 10

A arquitetura Scraper Training System (Spec 10) tentou blindar a extração contra mudanças de DOM usando um LLM para escrever scripts `page.evaluate`. Na prática:

- **Custo token alto e imprevisível** — cada "treino" queima 10k-50k tokens, e o modelo precisa repetir sempre que a MS altera a UI (semanalmente no Teams).
- **Latência inaceitável** — turnos de tool-calling com thinking adaptativo no Gemini Pro estouram 120s com frequência.
- **Frágil por design** — o DOM do Outlook/Teams é lazy-rendered (react-window), e um scraper que passa na validação pode voltar vazio no dia seguinte por scroll state.
- **Login frágil** — depende de `BrowserWindow` + cookies em partition persistente; 2FA corporativo quebra silenciosamente.

O Microsoft Graph API resolve os 4 problemas de uma vez: dados estruturados, pagination nativa, tokens oficiais, rate-limit documentado. O que o LLM ainda faz é o que ele faz bem: **resumir texto limpo**, não navegar DOM.

Além disso, o pipeline atual joga 100% das mensagens extraídas no LLM de digest — incluindo Jira, newsletter, notificações automáticas. Isso polui o resumo e gasta tokens. A Spec 11 introduz um **Communications Hub** onde o usuário faz a triagem antes da síntese.

---

## 2. Arquitetura Alvo

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. AUTH (Graph OAuth 2.0 Device Code)                           │
│    graphAuthService ──► SecureVault (access_token + refresh)    │
├─────────────────────────────────────────────────────────────────┤
│ 2. INGEST (background poll, 5min)                               │
│    graphMailService   /me/messages                              │
│    graphTeamsService  /me/chats + /chats/{id}/messages          │
│    ─► stripToPlainText ─► CommunicationItem[]                   │
│    ─► tabela RawCommunications                                  │
├─────────────────────────────────────────────────────────────────┤
│ 3. CURATION (UI React — Communications Hub)                     │
│    CommunicationHub                                             │
│      ├─ FilterPanel (blacklist / whitelist / source / unread)   │
│      ├─ MessageList  (checkbox default=true)                    │
│      └─ GenerateDigestButton                                    │
├─────────────────────────────────────────────────────────────────┤
│ 4. DIGEST (inalterado no contrato)                              │
│    digestService.generateDigestFromMessages(selected, callLLM)  │
│    ─► CommunicationDigest                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Módulos a **criar**

| Módulo | Responsabilidade |
|---|---|
| `electron/services/graph/graphAuthService.ts` | OAuth 2.0 Device Code flow via MSAL Node; persistência encriptada no `SecureVault`; refresh automático. |
| `electron/services/graph/graphClient.ts` | Wrapper HTTP sobre `https://graph.microsoft.com/v1.0` com retry/backoff/throttle e injeção do bearer. |
| `electron/services/graph/graphMailService.ts` | `fetchRecentMessages(since, top)` → `CommunicationItem[]`. |
| `electron/services/graph/graphTeamsService.ts` | `fetchRecentChatMessages(since)` iterando `/me/chats` → `CommunicationItem[]`. |
| `electron/services/graph/textSanitizer.ts` | `stripToPlainText(html)` — remove tags, assinaturas, disclaimers, blockquotes citados, collapses whitespace. |
| `electron/services/communicationsStore.ts` | Persiste `RawCommunications`, dedup por `graphId`, TTL 14 dias. |
| `src/components/Comms/CommunicationHub.tsx` | Shell — substitui `InboxView` como tela principal da aba "comunicações". |
| `src/components/Comms/FilterPanel.tsx` | Inputs de blacklist/whitelist + checkboxes de fonte + toggle unread. |
| `src/components/Comms/MessageList.tsx` | Virtualizada (`react-window`) — itens + checkbox. |
| `src/components/Comms/MessageItem.tsx` | Linha compacta: ícone fonte, remetente, assunto/preview, timestamp. |
| `src/components/Comms/GenerateDigestBar.tsx` | Rodapé fixo com contador + botão "Gerar Digest (N selecionados)". |

### Módulos a **deletar** (após cutover)

- `electron/services/extractors/**` (inteiro — `staticExtractor`, `trainer/*`, `playwrightService` se não usado por meetings)
- `src/components/UnifiedInbox/UnifiedInboxSetup.tsx`
- `src/components/Inbox/InboxView.tsx` (substituído — **o digest histórico continua visível dentro de `CommunicationHub` em uma segunda aba "Digests anteriores"**)
- Colunas/handlers de "treinar scraper" no IPC (`inbox:train-channel`, `inbox:auth` no fluxo Playwright)

### Módulos a **refatorar**

- `channelManager.ts` → passa a se chamar `channelRegistry.ts`, apenas expõe status de auth Graph (has_token / refresh_failed / not_connected) — sem Playwright, sem BrowserWindow.
- `digestService.generateDigestFromMessages` → contrato **inalterado** (`DigestMessage[]` in, `DigestSummary` out). É o que faz da curadoria um drop-in.
- `ipcHandlers.ts` → substituir os handlers de `inbox:*` pela nova superfície (seção 5).
- Remover `orchestratorService` FORMAT I (connect_inbox_channel via Playwright) — o connect agora é trivial (abrir URL de device-code num `shell.openExternal`).

---

## 3. Contrato de Dados

### 3.1 `CommunicationItem` (normalizado, pós-strip)

```typescript
export interface CommunicationItem {
  id: string;                    // uuid local (PK em RawCommunications)
  graphId: string;               // id do Graph — dedup key
  source: 'outlook' | 'teams';
  sender: string;                // "Nome <email>" ou "Nome (Teams)"
  senderEmail?: string;          // só outlook
  subject?: string;              // só outlook (teams → undefined)
  channelOrChatName?: string;    // só teams (nome do chat/canal)
  plainText: string;             // ≤ 4000 chars, pós textSanitizer
  timestamp: string;             // ISO 8601 (receivedDateTime / createdDateTime)
  isUnread: boolean;
  webLink?: string;              // deep-link Graph para abrir no cliente oficial
  importance?: 'low' | 'normal' | 'high'; // Outlook `importance`
  mentionsMe?: boolean;          // Teams: verifica `mentions[].mentioned.user.id === me.id`
}
```

### 3.2 Tabela `RawCommunications`

```sql
CREATE TABLE IF NOT EXISTS RawCommunications (
  id TEXT PRIMARY KEY,
  graph_id TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('outlook','teams')),
  sender TEXT NOT NULL,
  sender_email TEXT,
  subject TEXT,
  channel_name TEXT,
  plain_text TEXT NOT NULL,
  timestamp TEXT NOT NULL,            -- ISO 8601
  is_unread INTEGER DEFAULT 0,
  web_link TEXT,
  importance TEXT,
  mentions_me INTEGER DEFAULT 0,
  ingested_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_rawcomms_ts ON RawCommunications(timestamp DESC);
CREATE INDEX idx_rawcomms_source_ts ON RawCommunications(source, timestamp DESC);
```

TTL: `DELETE FROM RawCommunications WHERE timestamp < datetime('now', '-14 days')` num cron diário.

### 3.3 Tokens Graph (armazenamento)

Dois secrets no `SecureVault` já existente:

- `graph.access_token` (TTL ~60min — renovado antes de expirar)
- `graph.refresh_token` (TTL longo — rotacionado no refresh)

Mais um setting em `AppSettings`:
- `graph.account.upn` — User Principal Name para exibir na UI
- `graph.account.displayName`
- `graph.tenant_id`

---

## 4. Pipeline de Sanitização (`textSanitizer.ts`)

Regra de ouro: **o LLM nunca vê HTML, tabela, citação, disclaimer ou assinatura**. Etapas determinísticas (ordem importa):

1. Parsear HTML via `node-html-parser` (já é dep indireta, ou adicionar).
2. Remover nós: `script, style, head, meta, link, img, svg, video, audio, iframe, table` (tabelas viram bullets quando necessário no futuro — hoje, ignoradas).
3. Remover `<blockquote>` e qualquer nó cuja profundidade de quote (`div.gmail_quote`, `div[id^="OLK_SRC_BODY_SECTION"]`, `hr` seguido de "From:") seja > 0 — isto é, **não incluir a thread anterior**.
4. Converter `<br>` / `<p>` → `\n`.
5. Flatten para texto, colapsar `\s+` para um espaço, `\n{3,}` para `\n\n`.
6. Detectar e truncar assinatura: corte no primeiro match de `/(^--\s*$|^Atenciosamente,?\s*$|^Best regards,?\s*$|^Sent from my)/mi`.
7. Remover disclaimers corporativos comuns (confidentiality, "This e-mail and any files transmitted", pattern-set configurável em `AppSettings.sanitize.disclaimer_patterns`).
8. Hard cap: 4000 chars. Se estourar, preserva primeiros 3500 + `\n…[truncado]\n` + últimos 500.

Para Teams, o `body.content` muitas vezes já é texto simples + HTML leve de menção — mesma pipeline funciona, mas **preserva `@mentions`** como `@Nome`.

---

## 5. IPC Surface (`preload.ts` → `window.redbusAPI`)

Tudo novo vive sob `comms:*`. Removemos `inbox:authenticate`, `inbox:train-channel`, `inbox:disconnect`, `inbox:trigger-briefing`.

| IPC channel | Payload | Return |
|---|---|---|
| `comms:auth-start` | — | `{ status: 'OK' \| 'ERROR', deviceCode?, userCode?, verificationUri?, expiresIn? }` |
| `comms:auth-status` | — | `{ connected: boolean, upn?, displayName?, expiresAt? }` |
| `comms:auth-disconnect` | — | `{ status: 'OK' }` |
| `comms:list` | `{ since?: string; limit?: number; sources?: ('outlook'\|'teams')[] }` | `{ status, data: CommunicationItem[] }` |
| `comms:refresh` | — | `{ status, ingested: number }` (força poll imediato) |
| `comms:generate-digest` | `{ date: string; itemIds: string[] }` | idêntico ao `digest:generate` atual (fire-and-forget + events) |
| `comms:filter-presets` | — | `{ status, data: FilterPreset[] }` |
| `comms:filter-presets-save` | `FilterPreset` | `{ status }` |

`FilterPreset` é um JSON no `AppSettings` (`comms.filter_presets`) com `{ id, name, blacklist: string[], whitelist: string[], sources, unreadOnly }`.

Eventos push (via `webContents.send`):
- `comms:new-items` — `{ count: number, latestTimestamp: string }` (disparado a cada poll que trouxe algo novo)
- `digest:progress`, `digest:complete`, `digest:error` — reutilizados.

---

## 6. UI — Communications Hub

### 6.1 Layout

Reutiliza o shell existente (`view-layout` com `view-sidebar` + `view-detail`), mas **inverte a semântica**: a lista principal é o foco, não o digest já gerado.

```
┌─── view-layout ──────────────────────────────────────────────┐
│ ┌── view-sidebar (filter panel) ──┐ ┌── view-detail ───────┐ │
│ │ [FilterPanel]                   │ │ [MessageList]        │ │
│ │  • search box (auto whitelist)  │ │   checkbox | ícone   │ │
│ │  • blacklist chips + input      │ │   sender | subject   │ │
│ │  • whitelist chips + input      │ │   …preview | ts      │ │
│ │  • toggles: Email / Teams       │ │   …                  │ │
│ │  • toggle: Apenas não lidos     │ │                      │ │
│ │  • presets dropdown             │ │                      │ │
│ │  • [↻ refresh ingest]           │ │ [GenerateDigestBar]  │ │
│ │                                 │ │  12/44 selected      │ │
│ │ [Digests anteriores (collapse)] │ │  [Gerar digest]      │ │
│ └─────────────────────────────────┘ └──────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Componentes (contratos)

```tsx
<CommunicationHub />  // sem props — auto-fetch via IPC

<FilterPanel
  value={FilterState}
  onChange={(next: FilterState) => void}
  presets={FilterPreset[]}
  onSavePreset={(p) => void}
/>

<MessageList
  items={CommunicationItem[]}   // já filtrados client-side
  selectedIds={Set<string>}
  onToggle={(id: string) => void}
  onToggleAll={(checked: boolean) => void}
/>

<MessageItem
  item={CommunicationItem}
  selected={boolean}
  onToggle={() => void}
/>

<GenerateDigestBar
  total={number}                // visíveis
  selected={number}             // selected ∩ visíveis
  busy={boolean}
  blockReason?: string
  onGenerate={() => void}
/>
```

```typescript
interface FilterState {
  blacklist: string[];          // case-insensitive, OR
  whitelist: string[];          // case-insensitive, AND — vazio = passa
  sources: { outlook: boolean; teams: boolean };
  unreadOnly: boolean;
  searchQuery: string;          // input de busca livre — trata como whitelist efêmero
}
```

### 6.3 Regras de filtragem (client-side, sobre `items` ingeridos)

Aplicadas **em ordem**, todas sobre `plainText + sender + (subject||channelOrChatName||'')`:

1. `sources` — se a source do item está desligada, descarta.
2. `unreadOnly` — se ligado, só `isUnread === true`.
3. `blacklist` — se qualquer termo (case-insensitive, substring) bate, descarta.
4. `whitelist ∪ searchQuery` — se houver ao menos um termo, o item precisa bater pelo menos um (substring).
5. Ordenação final: `timestamp DESC`.

Seleção inicial: **todos os itens visíveis selecionados por default** (`selectedIds = new Set(items.map(i => i.id))`). Mudança de filtro **não** desmarca itens — mas o contador `selected ∩ visíveis` é o que vai no payload.

### 6.4 MessageItem — anatomia

```
[☑]  [icon]  Remetente       ·  hh:mm   [badge NÃO LIDO]
            Assunto ou primeiros 80 chars do plain text...
```

- Altura fixa 52px, `border-bottom: 1px solid var(--border)`.
- Hover: `background: var(--bg-hover)`.
- Classes: reutilizar `.inbox-ch-card` variants e `.view-sidebar-item` como base → criar `.comms-msg-item`, `.comms-msg-item.selected`, `.comms-msg-item.unread` no `index.css`.
- Ícone fonte: `<Mail size={13} />` (outlook, color `#ff6b2b` — usar `--accent` para unificar com tema) / `<Hash size={13} />` (teams).
- Timestamp: `HH:mm` se hoje, `DD/MM` caso contrário.

### 6.5 FilterPanel — interação

- Inputs são **chips**: digita termo + Enter → vira chip removível (`<span class="comms-chip"><X /></span>`).
- Debounce de 120ms no `onChange` do searchQuery para não thrashar a lista virtualizada.
- Botão "salvar preset" abre um prompt inline (reusar padrão do `TodoManager`).

### 6.6 GenerateDigestBar

- Fixo no rodapé de `view-detail` (posição sticky).
- Mostra `N selecionados de M visíveis`.
- Disable quando `N === 0`, com tooltip "selecione ao menos uma comunicação".
- Mostra blockReason se `comms:auth-status.connected === false` → "conecte o Microsoft 365".
- Ao clicar: chama `comms:generate-digest` com `{ date: today(), itemIds: Array.from(selectedIds ∩ visibleIds) }`.
- Durante progresso, reusa barra `.redbus-progress-bar` (mesmos eventos `digest:progress` / `digest:complete` / `digest:error`).

---

## 7. Payload para o LLM de Digest

O contrato do `digestService.generateDigestFromMessages(messages: DigestMessage[], callLLM)` **não muda**. O que muda é **quem monta o array** e **com que campos enriquecidos**.

Ordem de otimização (minimizar tokens sem perder sinal):

1. **Dedup** por `graphId` antes de mandar (proteção contra polls sobrepostos).
2. **Ordenar** por `(importance DESC, mentionsMe DESC, timestamp ASC)` — sinal de prioridade antes do tempo.
3. **Compactar corpo**: `plainText.slice(0, 800)` — 800 é o sweet spot empírico (completo para 95% dos e-mails curtos, preserva assunto+intro+call-to-action em longos).
4. **Enriquecer** com flags que o prompt do digest já entende:

```typescript
const payload: DigestMessage[] = items.map(i => ({
  channel: i.source,
  sender: i.sender,
  subject: i.subject,                      // undefined para teams
  preview: i.plainText.slice(0, 800),
  timestamp: i.timestamp,
  isUnread: i.isUnread,
  // ↓ novos (não-breaking — DigestMessage é estendido, não trocado)
  importance: i.importance,
  mentionsMe: i.mentionsMe,
}));
```

Extensão do `DigestMessage` em `digestService.ts`: adicionar campos opcionais `importance` e `mentionsMe` e citá-los no prompt (*"Priorize alto quando importance=high ou mentionsMe=true"*). Mantém backcompat com chamadores antigos (ignoram os campos).

Hard cap do array enviado: **80 itens**. Acima disso, o app força um toast exigindo filtros mais agressivos (protege budget de contexto independente do provider).

---

## 8. Autenticação — Device Code Flow

Escolha deliberada: **não** usar embedded webview nem `BrowserWindow`. Device Code evita MFA quebrado, funciona atrás de corporate proxy, e não armazena cookies no app.

### 8.1 Fluxo

1. UI chama `comms:auth-start`.
2. Backend chama `POST https://login.microsoftonline.com/common/oauth2/v2.0/devicecode` com `client_id` + `scope = "offline_access Mail.Read Chat.Read User.Read"`.
3. Backend devolve `{ userCode, verificationUri, expiresIn }`.
4. UI mostra painel: **"acesse `microsoft.com/devicelogin` e digite `ABCD-1234`"** com botão `shell.openExternal` e cópia automática do código.
5. Backend faz poll em `POST /token` a cada `interval` segundos até sucesso ou timeout.
6. Em sucesso: persiste `access_token` + `refresh_token` no `SecureVault`, `upn`/`displayName` em `AppSettings`, dispara `comms:auth-status` push.

### 8.2 Refresh

`graphClient` intercepta `401` e tenta 1x refresh via `refresh_token`. Se falhar → `authStatus.connected = false` + toast na UI com CTA "reconectar".

### 8.3 `client_id`

App registration multi-tenant. ID vai numa constante em `graphAuthService.ts` — **não secreta**, public client. Scopes: `offline_access`, `User.Read`, `Mail.Read`, `Chat.Read`, `ChatMessage.Read`.

---

## 9. Scheduler de Ingestão

Poll em background, owned pelo main process.

- `graphMailService.fetchRecentMessages({ top: 50, since: lastPollAt || '-24h' })` a cada **5 minutos**.
- `graphTeamsService.fetchRecentChatMessages({ since: lastPollAt || '-24h' })` a cada **5 minutos**.
- Ambos dedup por `graphId` contra `RawCommunications`.
- `lastPollAt` persistido em `AppSettings` (`graph.last_poll_mail`, `graph.last_poll_teams`).
- Backoff exponencial em `429` / `503` (respeita `Retry-After`).
- Primeiro poll após auth: janela de 72h para preencher a lista.

UI ouve `comms:new-items` e faz um merge incremental na lista (sem refetch completo).

---

## 10. Testes

| Arquivo | Cobertura |
|---|---|
| `test/graphAuthService.test.ts` | device code happy path, refresh token, 401 handling. |
| `test/textSanitizer.test.ts` | fixtures de email HTML real: signature strip, quote strip, disclaimer strip, truncation, Teams mention preservation. |
| `test/graphMailService.test.ts` | mock `fetch`, dedup por graphId, paginação, backoff 429. |
| `test/graphTeamsService.test.ts` | idem + resolução `mentionsMe` cruzando `me.id`. |
| `test/communicationsStore.test.ts` | upsert, TTL, query por source/since. |
| `test/CommunicationHub.test.tsx` | render, filtro blacklist/whitelist, checkbox toggle, selected counter, generate bar disable states. |
| `test/FilterPanel.test.tsx` | chip add/remove, preset save/load, debounce. |

Tudo rodável via `npx vitest run`. Sem testes E2E de Graph real — mocks de `fetch` no nível do `graphClient`.

---

## 11. Roadmap de Implementação

Ordem sugerida (cada passo entregável independente):

1. **Auth + Store** — `graphAuthService`, `graphClient`, `SecureVault` keys, tabela `RawCommunications`, handlers IPC `comms:auth-*`, UI `<GraphAccountCard />` (reusa `.inbox-ch-card`).
2. **Mail ingest** — `graphMailService` + `textSanitizer` + scheduler (só outlook, com poll). Valida via teste unitário e fixture.
3. **Teams ingest** — `graphTeamsService` + resolução de chats + dedup.
4. **Hub UI** — `CommunicationHub`, `FilterPanel`, `MessageList` (virtualizada), `MessageItem`, seleção default + filtros client-side, presets.
5. **Generate bar + wiring digest** — extensão do `DigestMessage`, handler `comms:generate-digest`, reuso do flow `digest:progress/complete/error`.
6. **Remoção do legado** — apagar `extractors/**`, `UnifiedInboxSetup`, `InboxView` (substituído), handlers IPC `inbox:*`, FORMAT I do `orchestratorService`. Mover "digests anteriores" como painel colapsável dentro do Hub.
7. **Polish** — preset sharing via export JSON, deep-link `webLink` ao clicar no item, keyboard shortcuts (`j/k` navega, `space` toggle, `g` gera).

Cada passo deve fechar com testes verdes no `npx vitest run`.

---

## 12. Considerações de Privacidade e Segurança

- **Scopes mínimos.** `Mail.Read` (não `Mail.ReadWrite`), `Chat.Read` (não `ChatMessage.Send`). O app é read-only em Graph.
- **Tokens** no `SecureVault` (já é encriptado via OS keychain).
- **Nunca** logar `access_token` nem corpo cru de e-mail em `activityLogger` — só metadata (source, sender, timestamp, bytes).
- **Sanitização obrigatória** antes de qualquer persistência. `plain_text` no DB já é stripped.
- **Opt-in explícito** no onboarding: tela com lista dos scopes e link para a política da MS.
- **Revogação**: `comms:auth-disconnect` chama `/common/oauth2/v2.0/logout` + `DELETE FROM RawCommunications` + remove keys do Vault.

---

## 13. O que esta spec **não** cobre

- Envio de e-mail / reply (fora de escopo — read-only).
- Attachments / arquivos (Graph exige `Files.Read`; adicionar só se o digest evoluir pra extrair anexos).
- Calendário (`/me/events` — candidato óbvio a Spec 12).
- Integração com outros providers (Gmail, Slack) — a camada é extensível (`source: 'outlook' | 'teams' | 'gmail' | ...`), mas cada um vira uma spec dedicada.
- Classificação automática por IA das comunicações (ranking/triagem inteligente) — hoje é 100% curadoria manual; IA só entra no digest final. Fica como extensão opcional numa spec futura.

