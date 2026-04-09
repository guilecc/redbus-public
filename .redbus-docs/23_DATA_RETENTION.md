# 23. DATA RETENTION & CLEANUP

## Retenção de Dados
O RedBus não tem TTL automático implementado. A limpeza de dados é manual via UI Settings (tab Sistema).

## Cleanup Manual
Via IPC handlers no `ipcHandlers.ts`:
- Limpeza de ScreenMemory (OCR antigo)
- Limpeza de MeetingMemory
- Limpeza de MemoryFacts
- Limpeza de ChatMessages + ConversationSummary

## Archive
- Exportação periódica via `archiveAndStartNewConversation`
- Ficheiros `.sqlite` em `userData/archives/`
- Listagem e delete via IPC

## Factory Reset
Reset completo que preserva apenas API keys (ProviderConfigs):
1. DELETE de todas as linhas de todas as tabelas (exceto ProviderConfigs)
2. Remove directório `archives/`
3. VACUUM do SQLite
4. Confirmação via texto "RESETAR" na UI

## WAL Mode
SQLite configurado com `PRAGMA journal_mode = WAL` para melhor performance em leituras concorrentes (sensores a escrever enquanto UI lê).

