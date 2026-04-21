# Spec 05 — Análise profunda oc × redbus (oportunidades extras)

> Este arquivo **não é um plano de implementação**. É um inventário ranqueado
> de coisas que o `oc` tem e o `redbus` não tem (ou tem em forma pobre), para
> você derivar specs próprias quando quiser. Cada item aponta para o arquivo
> real no `oc/` de onde copiar inspiração.
>
> As 4 specs anteriores cobrem: plugin registry (01), Skills (02), thinking
> (03), consumidores residuais do registry (04). Tudo aqui é **além disso**.

---

## P0 — Fundamentais (recomendado entrar na fase inicial do overhaul)

### 5.1 HITL — Aprovação de tool calls perigosas

**Estado redbus:** `forgeService.ts:13` tem um TODO (`// Dangerous commands
(rm -rf, sudo, mkfs) require HITL approval`), mas não existe fluxo de
aprovação. `orchestratorService` executa tool calls direto.

**Estado oc:** Fluxo completo em:
- `oc/src/acp/approval-classifier.ts` — classifica tool call em `auto` /
  `ask_user` / `deny` por regras configuráveis.
- `oc/src/acp/policy.ts` — política por workspace/sessão.
- `oc/src/security/audit-tool-policy.ts` — auditoria.

**Por que importa no redbus:** Skills (Spec 02) vão rodar scripts arbitrários
com acesso ao filesystem e à rede. Sem HITL, um skill comprometido = disco
apagado. Hoje `forgeService` já executa `execFile` cego.

**Forma mínima:** `ToolPlugin.approval?: 'auto' | 'ask' | { rule: (params) =>
'auto'|'ask' }`. Quando `ask`, o orchestrator emite no `streamBus` um evento
`tool-approval-request` e aguarda resposta do renderer (modal). UI vê params
diffados (para `write_file` mostra preview, para `shell` mostra a linha).

**Fica bom fazer junto com:** Spec 02 (Skills).

---

### 5.2 Hook system (lifecycle events de plugins)

**Estado redbus:** `streamBus` é só push de UI-events. Não há forma de um
plugin observar/mutar prompt antes da request, ou pós-processar resposta.

**Estado oc:** `oc/src/hooks/` + `config/config.hooks-module-paths.test.ts`.
Hooks nomeados (`pre-request`, `post-response`, `on-tool-call`, `on-error`)
que plugins registram com ordem/prioridade. Isso é **o** mecanismo que torna
a arquitetura de plugins do `oc` realmente extensível.

**Por que importa no redbus:** Vários casos que hoje viram patches no
`orchestratorService`:
- Redigir segredos em prompts outbound (hoje: inexistente).
- Injetar contexto de memória semântica antes do `chat()` (hoje: hard-coded
  em `orchestratorService._runMaestroCore`).
- Transcrição de áudio → auto-alimentar `memoryService` (hoje: chamada direta).

**Forma mínima:** Estender `PluginApi` em `electron/plugins/types.ts`:

```ts
export type HookPoint =
  | 'pre-request'
  | 'post-response'
  | 'pre-tool-exec'
  | 'post-tool-exec';

export interface PluginApi {
  // ...existente
  registerHook<T extends HookPoint>(
    point: T,
    fn: HookFn<T>,
    opts?: { order?: number },
  ): void;
}
```

`orchestratorService` passa a chamar `registry.runHook('pre-request', ctx)`
nos pontos-chave. Plugins internos (Skills, tools de forge) migram para
hooks em vez de acoplamento direto.

**Dependência:** Spec 01 (plugin registry) precisa estar pronto.

---

### 5.3 Auth profiles com rotação, cooldown e múltiplas chaves

**Estado redbus:** `ProviderConfigs` tem **uma** `apiKey` por provider.
`llmService`/`providerService` usam direto. `grep` por `rotation|cooldown|
retry|rate.?limit` em ambos retorna zero.

**Estado oc:** Infra completa em:
- `oc/src/agents/auth-profiles.ts` + ~15 testes irmãos.
- `oc/src/agents/auth-profiles.cooldown-auto-expiry.test.ts`
- `oc/src/agents/auth-profiles.resolve-auth-profile-order.*` — round-robin,
  last-good, manual.
- `oc/src/agents/api-key-rotation.ts`.

**Por que importa no redbus:** Um usuário que bate no limite do Anthropic ou
do Gemini hoje vê erro silencioso no maestro e o app fica preso. Se o
maestro está em chamada longa com streaming (o caso comum), é ruim.

**Forma mínima:**
1. Schema: transformar `ProviderConfigs.apiKey` em `apiKeys: string[]` (array),
   mais `cooldowns: { keyIdx: number, until: epoch }[]` em memória (não
   persistido).
2. Dentro do `ProviderPlugin.chat`, ao receber 429/5xx, marcar a key em
   cooldown por N ms, tentar próxima.
3. UI de Settings: lista de keys com status (ok / cooldown / last error).

Escopo bem menor que o do `oc` (não precisa de profiles complexos com
OAuth), mas captura o valor real: **continuar funcionando quando uma key
estourou**.

---

## P1 — Alto valor, independentes entre si

### 5.4 Slash commands (bypass do LLM)

**Estado redbus:** `grep slash|command:|/help|/clear src/components/Chat/`
retorna zero. Qualquer `/clear` vai pro maestro como prompt e volta uma
resposta em linguagem natural.

**Estado oc:** Registry completo:
- `oc/src/auto-reply/commands-registry.ts`
- `oc/src/auto-reply/command-detection.ts`
- `oc/src/auto-reply/commands-args.ts` — parsing de args tipados.

**Por que importa:** custo zero (nenhum token), UX previsível.
`/clear`, `/model gpt-4o`, `/think high`, `/skill run <id>`, `/debug` saem
do LLM path inteiro.

**Forma mínima:** `PluginApi.registerCommand({ name, description, args,
handler })`. Chat input: se começa com `/`, tenta match no registry antes
de mandar ao orchestrator.

---

### 5.5 MCP client (external tool servers)

**Estado redbus:** Inexistente.

**Estado oc:** `oc/src/mcp/` — implementação inteira de MCP client
(Model Context Protocol da Anthropic). Permite plugar servidores externos
(Filesystem, GitHub, Slack, Postgres, Linear, …) sem escrever um plugin
interno para cada um.

**Por que importa no redbus:** Redbus tem ~14 services e vai ter mais
skills. MCP é o caminho "padrão da indústria" para extender sem colonizar
o código. Um ToolPlugin interno pode wrappar um MCP server que o usuário
configura na UI de Settings → **MCP Servers**.

**Forma mínima:** Um ToolPlugin especial (`mcp-bridge`) que, no boot, lê
a config de MCP servers (stdio ou SSE), faz handshake, e registra
dinamicamente 1 ToolPlugin por tool exposta pelo server remoto. Reusa todo
o contrato da Spec 01.

**Dependência:** Spec 01. Compõe muito bem com 5.2 (hooks) para
observabilidade.

---

### 5.6 Prompt-cache stability (Anthropic)

**Estado redbus:** Não usa `cache_control` em lugar nenhum
(`grep cache_control electron/` → zero).

**Estado oc:** `oc/src/agents/anthropic-payload-policy.ts` —
invariante testado que garante que o prefixo do prompt (system + tools +
primeiros N turnos) fica **bit-estável** entre turnos, com breakpoints de
cache nos lugares certos. Tem testes de guardrail.

**Por que importa:** Anthropic cobra 10% do preço em tokens de cache hit
vs. 100% em cache miss. Em sessões longas do maestro (muitas iterações),
isso é direto no bolso e na latência.

**Forma mínima:** Dentro do plugin Anthropic, dividir a payload em:
- `system` (estável) + `tools` (estáveis) com `cache_control:
  { type: 'ephemeral' }` no último bloco de cada um.
- `messages[0..N-2]` com um `cache_control` no último turno "congelado".
- Só o último turno fica fora do cache.

Ganho medível com `input_tokens_cache_read` no response.

---

### 5.7 Diagnostics / `doctor`

**Estado redbus:** Muitas partes móveis sem autochecagem: OCR worker,
Accessibility permissions, Python executor, audio adapter, Playwright.
Quando algo quebra, o usuário só vê "sem resposta".

**Estado oc:** `oc/src/agents/auth-health.ts` + toda a família
`oc/src/security/audit-*` fazem sweeps diagnósticos acionáveis via CLI.

**Por que importa no redbus:** uma tela Settings → **Diagnostics** com
botão "Run checks" que lista:
- Providers: todas as keys ok? modelos acessíveis?
- macOS: Accessibility/Screen Recording/Microphone granted?
- Python executor: encontra `python3`? tem `requirements`?
- Ollama local: serviço up?
- Disk: `~/.redbus/skills` writable?

**Forma mínima:** Novo `electron/services/doctorService.ts` com
`runChecks(): Promise<DiagnosticReport>` chamando helpers já existentes
em cada service. UI nova simples.

---

## P2 — Polimento (deixar pra depois de 01–04 estarem de pé)

### 5.8 Per-conversation model override

`oc/src/sessions/model-overrides.ts`. Hoje redbus tem
`maestroModel`/`workerModel` globais em `ProviderConfigs`. UX natural:
dropdown no header da conversa.

### 5.9 Context compaction policy

`oc/src/context-engine/` + `summariz` patterns. `memoryService` já faz
summarization sob demanda, mas não tem loop automático quando o turno
passa de X tokens. `oc` tem política declarativa de compaction que evita
explosão de contexto em sessões longas.

### 5.10 Session lifecycle + transcript events

`oc/src/sessions/session-lifecycle-events.ts`,
`oc/src/sessions/transcript-events.ts`. redbus tem histórico em SQLite mas
nenhum evento estruturado de ciclo de vida para plugins consumirem. Fica
trivial depois de 5.2 (hooks).

### 5.11 Static architecture guardrails

`oc/src/agents/acp-binding-architecture.guardrail.test.ts` e irmãos — são
testes que **falham no CI** se alguém escrever `model.includes('claude')`
fora do plugin Anthropic. redbus beneficia muito disso **depois da Spec 04**,
como fiador de que a migração não regrida.

Exemplo:

```ts
// test/architecture.guardrail.test.ts
it('no hardcoded model branches outside plugins', async () => {
  const hits = await grepSource(/model\.(includes|startsWith)\(['"]\w+/, {
    exclude: ['electron/plugins/providers/**'],
  });
  expect(hits).toEqual([]);
});
```

### 5.12 Rate-limit / retry policy genérica

Hoje providers não têm retry. Um wrapper `withBackoff` dentro do registry
que todo `ProviderPlugin.chat` passa, configurável por provider (exp
backoff em 429/503/timeouts de rede).

---

## Matriz de decisão rápida

| # | Título | Esforço | Impacto | Depende de |
|---|---|---|---|---|
| 5.1 | HITL approval | M | **Alto** (segurança de Skills) | Spec 02 |
| 5.2 | Hook system | M | **Alto** (destrava N futuros) | Spec 01 |
| 5.3 | Auth rotation | S | **Alto** (robustez visível) | Spec 01 |
| 5.4 | Slash commands | S | Médio | Spec 01 |
| 5.5 | MCP client | L | **Alto** (escala sem código) | Spec 01 |
| 5.6 | Prompt cache | S | Médio ($) | plugin Anthropic |
| 5.7 | Doctor | M | Médio (suporte) | — |
| 5.8 | Per-conv model | S | Baixo | — |
| 5.9 | Compaction | M | Médio | memoryService |
| 5.10 | Session events | S | Baixo (só depois de 5.2) | 5.2 |
| 5.11 | Guardrails | S | Alto (evita regressão) | Spec 04 |
| 5.12 | Retry policy | S | Médio | Spec 01 |

Esforço: S=dias, M=1–2 sem, L=2–4 sem.

---

## Sugestão de sequenciamento

1. **Spec 01** (já planejado).
2. Em paralelo: **5.2 hooks** (destrava muita coisa) e **5.3 auth rotation**
   (valor imediato pro usuário).
3. **Spec 02 Skills** + **5.1 HITL** (andam juntos).
4. **Spec 03 thinking** + **Spec 04 cleanup**.
5. **5.11 guardrails** logo depois de 04 (trava o ganho).
6. **5.4 slash commands** + **5.6 prompt cache** (itens curtos, altos retornos).
7. **5.5 MCP** quando o plugin system estiver calejado.
8. **5.7 doctor**, **5.8**, **5.9**, **5.10**, **5.12** conforme dor aparece.

---

## Coisas do `oc` que **deliberadamente** não estão aqui

Essas existem no `oc` mas não fazem sentido pro redbus no curto/médio prazo:

- **ACP server** (`oc/src/acp/server.ts`) — só faz sentido se redbus virar
  backend de outra UI (ex.: Claude Code integration). Não é o caso hoje.
- **Gateway HTTP** (`oc/src/gateway/`) — redbus é single-user desktop.
- **Docker sandbox** (`oc/src/docker-*.ts`) — Python executor + filesystem
  escopado do usuário já servem.
- **CLI inteiro** (`oc/src/cli/**`) — redbus é GUI Electron.
- **Canvas-host / A2UI** (`oc/src/canvas-host/`) — UI é React Electron, não
  TUI remoto.
- **Realtime voice/transcription providers** — redbus já tem
  `localTranscriber`. Migrar pra registry faz sentido só depois de haver
  um 2º provider realtime real (hoje é só Whisper one-shot).
- **i18n, installer wizard, proxy-capture** — escopo diferente.

Se um dia algum destes passar a fazer sentido, vira spec nova.

