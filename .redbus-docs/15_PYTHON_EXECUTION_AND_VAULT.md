# 15. PYTHON EXECUTION & VAULT

## pythonExecutor.ts
Executa scripts Python como child_process com injeção segura de tokens do Vault.

### Fluxo
1. Recebe `script`, `vaultKeys[]`, `args{}`
2. Lê tokens do SecureVault, decifra via `safeStorage.decryptString()`
3. Monta variáveis de ambiente: `REDBUS_<SERVICE_NAME>` = token decifrado + `REDBUS_DB_PATH` = caminho absoluto do banco SQLite
4. Cria ficheiro temporário em `/tmp/redbus_script_*.py`
5. Executa: `python3 <tempFile>` com env vars injetadas
6. Timeout de 120 segundos
7. Captura stdout + stderr
8. Apaga ficheiro temporário no `finally`

### Formato de Saída
```json
{ "stdout": "...", "stderr": "...", "exitCode": 0|1 }
```

## SecureVault (vaultService.ts)
Cofre de tokens cifrados pelo OS usando `safeStorage` do Electron.

### Tabela
```sql
CREATE TABLE SecureVault (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL UNIQUE,
  encrypted_token TEXT NOT NULL
);
```

### API
- `saveSecret(db, serviceName, plainToken)` — cifra + INSERT OR REPLACE
- `listSecrets(db)` — retorna `[{id, service_name}]` (sem tokens)
- `deleteSecret(db, serviceName)` — DELETE
- `getDecryptedToken(db, serviceName)` — decifra e retorna token plain

### Segurança
- Tokens cifrados via `safeStorage.encryptString()` → base64 no SQLite
- `safeStorage` usa Keychain (macOS), libsecret (Linux), DPAPI (Windows)
- Tokens nunca expostos ao renderer process
- Injetados apenas como env vars em processos Python filhos

