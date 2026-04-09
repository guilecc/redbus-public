# 18. PROACTIVITY ENGINE

## Conceito
Motor de subconsciente que monitora sinais ambientais e decide proativamente se deve intervir na conversa, sem pedido explícito do utilizador.

## proactivityEngine.ts

### Níveis de Proatividade
| Nível | Intervalo Base | Cooldown | Comportamento |
|-------|---------------|----------|---------------|
| OFF | — | — | Desativado |
| LOW | 120s | 300s (5min) | Só reage a mudanças fortes, avalia raramente |
| MEDIUM | 60s | 120s (2min) | Avalia periodicamente, sugere quando relevante |
| HIGH | 30s | 60s (1min) | Avalia frequentemente, proativo máximo |

### Timings Configuráveis
`levelTimings` parametrizáveis por nível via IPC:
- `intervalMs` — frequência de avaliação
- `cooldownMs` — tempo mínimo entre intervenções

### Máquina de Estados
```
IDLE → EVALUATING → IDLE
IDLE → COOLDOWN → IDLE
```
- `IDLE`: pronto para próxima avaliação
- `EVALUATING`: chamando LLM para decidir
- `COOLDOWN`: após intervenção, espera `cooldownMs`

### Fluxo de Avaliação
1. Timer dispara (cada `intervalMs`)
2. Verifica guards: nível OFF? agente BUSY? em COOLDOWN?
3. Recolhe sinais: clipboard, activeWindow, accessibilityTree
4. Se não há mudanças significativas → skip
5. Envia ao LLM (modelo Worker) com contexto + últimas mensagens
6. LLM responde JSON: `{ should_intervene: bool, message, reason, confidence }`
7. Se `should_intervene && confidence >= 0.6`:
   - Salva mensagem como `type='proactive'`
   - Emite `chat:new-message` ao renderer
   - Entra em COOLDOWN
8. Se não: reset timer

### Detecção de Mudanças
`hasSignificantChanges()` — compara sinais atuais com `lastEvaluatedSignals`:
- Hash MD5 de clipboard, windowTitle, AX tree
- Se qualquer hash diferente → mudança significativa

### Reset
`_resetEngine()` — limpa estado, usado em testes e factory reset.

