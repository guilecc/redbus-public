# 24. MAESTRO THINKING & REASONING PROTOCOL

## Thinking Obrigatório
Cada decisão do Maestro inclui raciocínio estruturado em 5 passos, salvo como mensagem `type='thinking'` no ChatMessages.

## 5 Passos
1. **UNDERSTAND** — Reformular o pedido do utilizador nas próprias palavras
2. **CONTEXT REVIEW** — Listar contexto disponível: mensagens recentes, clipboard, window ativa, MemoryFacts relevantes, skills disponíveis
3. **CANDIDATES** — Listar ≥2 FORMATs candidatos com prós/contras
4. **DECISION** — Escolher FORMAT e justificar
5. **SELF-CRITIQUE** — Validar a decisão: é a mais eficiente? Há riscos?

## Implementação
No `orchestratorService.ts`:
1. LLM retorna JSON com campo `thinking`
2. `parsedSpec.thinking` é extraído e salvo separadamente
3. `delete parsedSpec.thinking` antes de persistir o spec
4. Thinking salvo como ChatMessage `type='thinking'` (nunca mostrado ao utilizador)

## Benefícios
- Rastreabilidade: cada decisão tem justificação
- Debugging: se o agente escolhe mal, pode-se ler o raciocínio
- Quality gate: o self-critique previne decisões precipitadas

## Anti-Refusal Integration
O thinking ajuda a calibrar a resposta do LLM. Se o LLM identifica no CONTEXT REVIEW que tem autorização, é menos provável que recuse no DECISION.

