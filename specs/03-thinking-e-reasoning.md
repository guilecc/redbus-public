# Spec 03 — Thinking & Reasoning Levels

## Objetivo

Cobrir os itens (3) *exibição de thinking* e (4) *nível de thinking* do
pedido original. Alvos:

1. Um único enum `ThinkLevel` canônico atravessa UI → orquestrador →
   provider plugin (Spec 01). Cada provider traduz para o parâmetro
   nativo **internamente**.
2. Um único canal de eventos (`streamBus`) carrega
   `thinking-start|chunk|end` vindo de qualquer provider — sem
   código vendor-específico fora do plugin.
3. UI reativa: renderiza thinking ao vivo por `requestId`, colapsável,
   com seletor de nível por conversa e por modelo.

## Estado atual (`redbus`)

- `electron/services/streamBus.ts` já define
  `thinking-start|chunk|end` (linhas 13–25). Base boa, reaproveitar.
- Parsing existe só em `ollamaStreamParser.ts` e
  `claudeStreamParser.ts` — não unificado.
- UI: `src/components/Chat/MessageBubble.tsx` tem `ThinkingInline`
  (linhas 45–66) com `active`/`text` e chevron. Consome via props.
- Configuração: só `src/components/Settings/OllamaSettings.tsx`
  expõe algo. Não existe seletor por-conversa.

## Padrão de inspiração (`oc/`)

### 1. Enum canônico (`oc/src/auto-reply/thinking.shared.ts`)

```ts
export type ThinkLevel =
  | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "adaptive";
```

Com `normalizeThinkLevel(raw)` que aceita aliases populares:

- `on`, `enable`, `enabled` → `low`
- `ultrathink`, `highest`, `max` → `high`
- `think-harder`, `harder` → `medium`
- `auto` → `adaptive`
- `extra-high`, `xhigh` → `xhigh`

Helpers adicionais: `listThinkingLevels(provider, model)` (subset
suportado) e `supportsBuiltInXHighThinking`.

### 2. Stream de thinking (Anthropic — `oc/src/agents/anthropic-transport-stream.ts`)

O transport emite três eventos separados de texto:
`thinking_start` / `thinking_delta` / `thinking_end`. O parser vendor-
específico fica no transport, não no consumidor.

### 3. Mapeamento por provider (ex: `oc/extensions/anthropic/register.runtime.ts`)

`ThinkLevel` → payload nativo:
`{ thinking: { type: "enabled", budget_tokens: N } }`.

## Plano no `redbus`

### Fase 1 — Enum e normalização

1. Criar `electron/services/thinking.ts` exportando `ThinkLevel` e
   `normalizeThinkLevel` (copiar tabela de aliases do `oc/`).
2. Estender `ProviderPlugin.capabilities.thinking` (Spec 01) com:

```ts
export interface ThinkingCapability {
  supported: ThinkLevel[];
  default: ThinkLevel;
  /** traduz o level canônico para payload do provider */
  toRequestOptions(level: ThinkLevel, model: string): Record<string, unknown>;
  /** parseia chunks do stream e devolve eventos canônicos */
  parseStreamChunk(chunk: unknown): ThinkingStreamEvent[];
}

export type ThinkingStreamEvent =
  | { type: 'thinking-start' }
  | { type: 'thinking-chunk'; text: string }
  | { type: 'thinking-end' };
```

### Fase 2 — Implementações por provider (tabela de referência)

- **Anthropic**: `{ thinking: { type: 'enabled', budget_tokens: N } }`.
  Sugestão de N por nível: `minimal=1024`, `low=2048`, `medium=8192`,
  `high=16384`, `xhigh=32768`. `off` → omite o campo.
- **OpenAI (o-series / gpt-5-thinking)**:
  `{ reasoning_effort: 'low'|'medium'|'high' }`. `minimal`→`low`,
  `xhigh`→`high`, `adaptive`→auto.
- **Google (Gemini thinking)**:
  `{ generationConfig: { thinkingConfig: { thinkingBudget: N } } }`.
- **Ollama**: depende do modelo (gpt-oss, qwen3-thinking, etc.). Usa
  `think: true | 'low' | 'medium' | 'high'` conforme versão. Modelo
  sem suporte → `toRequestOptions` retorna `{}` e
  `supported = ['off']`.

Os parsers atuais (`ollamaStreamParser`, `claudeStreamParser`) são
**absorvidos** por `parseStreamChunk` dentro de cada provider plugin.

### Fase 3 — Orquestrador e bus

- O orquestrador chama `capability.parseStreamChunk` e repassa para
  `emitThinkingStart/Chunk/End` do `streamBus`.
- Toda lógica de thinking em `llmService.ts` é removida.

### Fase 4 — UI

1. Store renderer (Zustand/Context) indexada por `requestId`,
   acumulando `thinkingText` a partir de `stream:event`.
2. `MessageBubble.tsx` deixa de receber `thinkingText`/`isThinking`
   por props e lê da store pelo `requestId`.
3. Novo `src/components/Chat/ThinkingLevelPicker.tsx`: radiogroup
   com os níveis retornados por `capability.supported` do provider
   atual. Persiste em settings **por conversa** (não global).
4. Em Settings, mostrar o seletor default de conversa só quando
   `capability.supported.length > 1`.

## Critérios de sucesso

- `thinking_level` por conversa funciona para Anthropic, OpenAI
  (o/gpt-5-thinking), Gemini e Ollama (quando o modelo suporta).
- UI mostra "pensando..." ao vivo e colapsa o raciocínio ao terminar
  para **qualquer** provider — sem código vendor-específico em
  `MessageBubble.tsx`.
- `normalizeThinkLevel('ultrathink')` → `'high'`,
  `normalizeThinkLevel('auto')` → `'adaptive'` (paridade com `oc/`).
- Providers/modelos sem thinking escondem o seletor automaticamente
  (`supported.length === 1 && supported[0] === 'off'`).
- Testes novos em `test/` cobrem `normalizeThinkLevel` e ao menos 1
  `parseStreamChunk` por provider.

## Fora de escopo

- Gravação persistente do "pensamento" no DB (hoje é efêmero; decidir
  em spec futura se queremos histórico).
- Edição do budget de tokens pelo usuário (por enquanto, preset por
  nível).

