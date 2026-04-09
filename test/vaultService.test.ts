import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  safeStorage: null, // Use fallback (base64) in tests
}));

import { initializeDatabase, factoryReset } from '../electron/database';
import {
  saveSecret,
  getSecret,
  getSecretByService,
  listSecrets,
  deleteSecret,
  getSecretsByServices,
} from '../electron/services/vaultService';

describe('VaultService — SecureVault', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('1. Deve salvar e recuperar um secret por ID', () => {
    saveSecret(db, 'jira-1', 'jira', 'my-jira-token-123');
    const token = getSecret(db, 'jira-1');
    expect(token).toBe('my-jira-token-123');
  });

  it('2. Deve recuperar um secret por service_name', () => {
    saveSecret(db, 'gh-1', 'github', 'ghp_abc123');
    const token = getSecretByService(db, 'github');
    expect(token).toBe('ghp_abc123');
  });

  it('3. Deve retornar null para ID inexistente', () => {
    expect(getSecret(db, 'nonexistent')).toBeNull();
  });

  it('4. Deve listar secrets sem expor tokens', () => {
    saveSecret(db, 'jira-1', 'jira', 'token1');
    saveSecret(db, 'gh-1', 'github', 'token2');

    const secrets = listSecrets(db);
    expect(secrets).toHaveLength(2);
    expect(secrets[0].service_name).toBeDefined();
    // Tokens should NOT be in the list
    expect((secrets[0] as any).encrypted_token).toBeUndefined();
  });

  it('5. Deve deletar um secret por ID', () => {
    saveSecret(db, 'jira-1', 'jira', 'token1');
    expect(deleteSecret(db, 'jira-1')).toBe(true);
    expect(getSecret(db, 'jira-1')).toBeNull();
  });

  it('6. Deve fazer upsert ao salvar com mesmo ID', () => {
    saveSecret(db, 'jira-1', 'jira', 'old-token');
    saveSecret(db, 'jira-1', 'jira', 'new-token');
    expect(getSecret(db, 'jira-1')).toBe('new-token');
    expect(listSecrets(db)).toHaveLength(1);
  });

  it('7. Deve retornar múltiplos secrets por service names', () => {
    saveSecret(db, 'jira-1', 'jira', 'jira-token');
    saveSecret(db, 'gh-1', 'github', 'gh-token');
    saveSecret(db, 'aws-1', 'aws', 'aws-token');

    const result = getSecretsByServices(db, ['jira', 'github']);
    expect(result).toEqual({ jira: 'jira-token', github: 'gh-token' });
    expect(result.aws).toBeUndefined();
  });

  it('8. SecureVault deve ser limpa no factoryReset', () => {
    saveSecret(db, 'jira-1', 'jira', 'token');
    factoryReset(db, '/tmp/nonexistent');
    expect(listSecrets(db)).toHaveLength(0);
  });
});

