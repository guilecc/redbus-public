# 26 — Native Tooling: Digests (FORMAT J) & Parallel Tools (FORMAT K)

## Problema resolvido

Anteriormente, quando o Maestro recebia perguntas sobre comunicações (emails/Teams), ele não tinha uma tooling nativa para dados de digests. A única opção era escrever um script Python para consultar o SQLite — o que frequentemente falhava ou gerava latência desnecessária. Para perguntas que exigiam informações tanto de reuniões quanto de comunicações, o Maestro só conseguia responder um dos dois.

---

## Arquitetura

### FORMAT J — Search Digest Memory

Tooling nativa equivalente ao FORMAT H (Meeting Memory), mas para a tabela `CommunicationDigest`.

```json
{
  "thinking": "...",
  "goal": "Verificar digests da última semana",
  "search_digest_memory": {
    "query": "string opcional — busca no summary_json",
    "channel": "outlook | teams | all (opcional)",
    "date_filter": "today | yesterday | this_week | last_week | YYYY-MM-DD (opcional)"
  },
  "steps": []
}
```

**Regra:** Use FORMAT J quando o usuário perguntar sobre emails, Teams, tópicos comunicados ou action items de comunicações. **NUNCA usar FORMAT B (Python) para isso.**

### FORMAT K — Parallel Native Tools

Permite ao Maestro disparar múltiplas toolings nativas em paralelo. O backend usa `Promise.all` para executar `search_meeting_memory` e `search_digest_memory` simultaneamente e depois sintetiza os resultados com um único Worker LLM call.

```json
{
  "thinking": "...",
  "goal": "O que aconteceu esta semana?",
  "parallel_tools": [
    {
      "tool": "search_meeting_memory",
      "label": "Analisar reuniões da semana passada",
      "args": { "date_filter": "this_week" }
    },
    {
      "tool": "search_digest_memory",
      "label": "Verificar digests de email e Teams",
      "args": { "date_filter": "this_week" }
    }
  ],
  "steps": []
}
```

**Regra:** Use FORMAT K quando a resposta requer AMBOS dados de reuniões E digests de comunicação. Exemplos típicos:
- "o que aconteceu esta semana?"
- "o que eu preciso fazer hoje baseado na minha semana?"
- "me resuma a semana passada"
- "quais são minhas prioridades considerando reuniões e comunicações?"

---

## Implementação

### `digestService.ts` — `searchDigestMemory()`

```typescript
searchDigestMemory(db, query, limit = 5)
// query: string | { query?, channel?, date_filter? }
```

Suporta:
- `string` → busca LIKE no `summary_json`
- `object.query` → busca LIKE no `summary_json`
- `object.channel` → filtra por canal (`outlook`, `teams`; `all` desativa filtro)
- `object.date_filter` → `today`, `yesterday`, `this_week`, `last_week`, ou `YYYY-MM-DD`

### `orchestratorService.ts` — Handlers

**FORMAT J handler** (linha ~950):
1. Chama `searchDigestMemory(db, query, 5)`
2. Parseia `summary_json` de cada resultado
3. Chama `synthesizeTaskResponse` para resposta conversacional
4. Retorna `conversational_reply` diretamente (sem execução de Worker browser)

**FORMAT K handler** (linha ~1010):
1. Recebe array `parallel_tools`
2. Executa `Promise.all(tools.map(async (t) => {...}))` — todas as ferramentas em paralelo
3. Cada ferramenta (meeting ou digest) popula seu próprio resultado
4. Chama `synthesizeTaskResponse` com **todos os resultados combinados**
5. Retorna `conversational_reply` + `parallel_results[]` para o frontend

---

## Fluxo de Dados (FORMAT K)

```
User: "o que aconteceu essa semana?"
        │
        ▼
   Maestro LLM
   → FORMAT K com 2 parallel_tools
        │
        ├── Promise.all([
        │     searchMeetingMemory(db, { date_filter: 'this_week' }),
        │     searchDigestMemory(db, { date_filter: 'this_week' })
        │   ])
        │
        ▼
   synthesizeTaskResponse(db, goal, [meetingsData, digestsData])
        │
        ▼
   conversational_reply → Frontend
```

---

## Testes

`test/digestSearch.test.ts` — 9 testes cobrindo:
- Busca por string (overload simples)
- Busca por query object
- Filtro por channel (outlook, teams, all)
- Filtros de data: `this_week`, `yesterday`, data exata
- Ordenação DESC por data
- Respeito ao limit
- Combinação de filtros channel + query
