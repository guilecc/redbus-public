# 11. DYNAMIC LLM CONFIG

## Modelo Agnóstico
O RedBus suporta 3 provedores de LLM com modelos configuráveis pelo utilizador:

| Provider | Endpoint | Formato |
|----------|----------|---------|
| OpenAI | `https://api.openai.com/v1/chat/completions` | OpenAI SDK |
| Anthropic | `https://api.anthropic.com/v1/messages` | Anthropic SDK (system separado) |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/models` | Gemini REST (JSON Schema) |

## ProviderConfigs (Tabela SQLite)
Single row (id=1):
```sql
CREATE TABLE ProviderConfigs (
  id INTEGER PRIMARY KEY,
  openai_key TEXT, anthropic_key TEXT, google_key TEXT,
  maestro_provider TEXT, maestro_model TEXT,
  worker_provider TEXT, worker_model TEXT
);
```

## Resolução de Modelo
`resolveModelConfig(db)` em llmService.ts:
- Lê ProviderConfigs
- Retorna `{ maestro: {provider, model, apiKey}, worker: {provider, model, apiKey} }`
- Se não há config, retorna null (UI deve pedir configuração)

## Fetch Unificado
`callLLM(apiKey, provider, model, systemPrompt, messages, options)`:
- Monta headers e body conforme o provider
- `temperature`, `maxTokens` configuráveis
- Suporta `tools` (para Gemini: converte para `functionDeclarations`)
- Timeout via `AbortController` (padrão 120s, configurável)
- Antropic: converte `{ role:'system' }` em campo `system` top-level
- Gemini: converte mensagens de `tool` para `functionResponse`

## ProviderService
Lista modelos disponíveis via API de cada provider:
- OpenAI: `GET /v1/models` (filtra `gpt-`)
- Anthropic: `GET /v1/models` (filtra `claude-`)
- Google: `GET /v1beta/models` (filtra `generateContent`)

## Tool-Use Compatibility
- OpenAI: `tools[].type='function'` + `tool_calls` no response
- Anthropic: `tools[].input_schema` + content block `type='tool_use'`
- Gemini: `tools[].functionDeclarations` + `functionCall` em parts

