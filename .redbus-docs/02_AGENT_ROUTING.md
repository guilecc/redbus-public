# 02. AGENT ROUTING — Maestro + Worker

## Fluxo de Decisão do Maestro
O Maestro (`orchestratorService.ts`) recebe o prompt do utilizador e decide qual FORMAT usar. Implementa 8 formatos de resposta JSON:

| FORMAT | Nome | Quando Usar |
|--------|------|------------|
| A | Browser Spec | Navegar websites (steps url+instruction) |
| B | Python Execution | Script Python one-off (API calls, cálculos) |
| C | Conversational | Resposta textual sem ação |
| D | Execute Existing Skill | Usar skill do ForgeSnippets |
| E | Forge New Skill | Criar nova skill Python + executar |
| F | Search Screen Memory | Buscar OCR na ScreenMemory (FTS5) |
| G | Read Native Window Tree | Ler árvore AX via accessibilitySensor |
| H | Search Meeting Memory | Buscar em atas de reuniões (FTS5) |

## Thinking Protocol (Obrigatório)
Cada JSON do Maestro inclui `thinking` com 5 passos: UNDERSTAND, CONTEXT REVIEW, CANDIDATES, DECISION, SELF-CRITIQUE. Campo removido antes de persistir e salvo em ChatMessages com `type='thinking'`.

## Máquina de Estados
```
IDLE ←→ BUSY
```
- `BUSY` durante createSpecFromPrompt e avaliação proativa
- ProactivityEngine verifica estado antes de agir

## Context Builder (5 tiers em buildContextFromDB)
1. **MemoryFacts** — factos permanentes (máx 30% budget)
2. **ConversationSummary** — resumo compactado (máx 40%)
3. **Recent Messages** — últimas 10 não-compactadas (com dedup)
4. **Retrieved Context** — FTS5 search relevante ao prompt
5. **Environmental Context** — activeWindow, clipboard, AX tree

Budget: `MAX_CONTEXT_TOKENS = 8000`

## Anti-Refusal
Deteta recusas (regex: recus|refuse|cannot|segurança) e faz retry com override prompt reforçando autorização local.

