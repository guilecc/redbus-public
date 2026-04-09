# 13. CONTEXT COMPACTION & SINGLE SESSION

## Sessão Única
O RedBus opera em sessão única contínua. A tabela `Conversations` tem sempre uma conversa ativa (id='main'). O histórico é contínuo; quando fica grande, é compactado.

## Compaction Rolling (archiveService.ts)

### Trigger
Chamado ao salvar nova mensagem de assistente (`saveMessage`). Conta mensagens não-compactadas; se > 20, dispara compaction.

### Algoritmo
1. Lê todas as mensagens não-compactadas (ordered by createdAt)
2. Separa: `toCompact` (todas exceto últimas 6) + `toKeep` (últimas 6)
3. Lê `ConversationSummary` existente (se houver)
4. Envia `toCompact` + summary anterior ao Worker LLM para gerar novo resumo
5. Salva/atualiza `ConversationSummary` com o novo resumo
6. Marca `toCompact` como `compacted = 1`

### ConversationSummary
```sql
CREATE TABLE ConversationSummary (
  id TEXT PRIMARY KEY DEFAULT 'main',
  summary TEXT NOT NULL,
  messagesCompacted INTEGER DEFAULT 0,
  updatedAt DATETIME
);
```

## Archive (Exportação)
- `archiveAndStartNewConversation(db, mainWindow)` — exporta BD como `.sqlite`, limpa ChatMessages/LivingSpecs/ConversationSummary
- Ficheiros exportados salvos em `userData/archives/redbus_archive_TIMESTAMP.sqlite`
- Lista via `archive:list`, apaga via `archive:delete`

## Factory Reset
`factoryReset(db, userDataPath)`:
- DELETE de todas as tabelas
- EXCEPT: ProviderConfigs (preserva API keys)
- Remove directório `archives/`
- VACUUM do SQLite

