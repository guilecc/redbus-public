/**
 * VaultService — Manages encrypted secrets for external services.
 * Uses Electron's safeStorage to encrypt/decrypt tokens at rest.
 * Tokens are stored as base64-encoded encrypted blobs in the SecureVault table.
 */

let safeStorage: typeof import('electron').safeStorage | null = null;

try {
  // safeStorage is only available in the main process at runtime
  safeStorage = require('electron').safeStorage;
} catch {
  // Unavailable in test/mock environments
}

export interface VaultEntry {
  id: string;
  service_name: string;
  createdAt?: string;
}

/**
 * Encrypt a plaintext token using Electron's OS-level keychain (safeStorage).
 * Falls back to base64 encoding if safeStorage is unavailable (tests).
 */
function encryptToken(plaintext: string): string {
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(plaintext);
    return encrypted.toString('base64');
  }
  // Fallback for test environments (NOT secure — only for tests)
  return Buffer.from(plaintext).toString('base64');
}

/**
 * Decrypt a token stored in the vault.
 */
function decryptToken(encryptedBase64: string): string {
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(encryptedBase64, 'base64');
    return safeStorage.decryptString(buffer);
  }
  // Fallback for test environments
  return Buffer.from(encryptedBase64, 'base64').toString('utf-8');
}

/**
 * Save a secret to the vault (upsert).
 */
export function saveSecret(db: any, id: string, serviceName: string, token: string): void {
  const encrypted = encryptToken(token);
  db.prepare(`
    INSERT INTO SecureVault (id, service_name, encrypted_token)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      service_name = excluded.service_name,
      encrypted_token = excluded.encrypted_token,
      createdAt = CURRENT_TIMESTAMP
  `).run(id, serviceName, encrypted);
}

/**
 * Get a decrypted secret by its ID.
 */
export function getSecret(db: any, id: string): string | null {
  const row = db.prepare('SELECT encrypted_token FROM SecureVault WHERE id = ?').get(id) as any;
  if (!row) return null;
  return decryptToken(row.encrypted_token);
}

/**
 * Get a decrypted secret by service name.
 */
export function getSecretByService(db: any, serviceName: string): string | null {
  const row = db.prepare('SELECT encrypted_token FROM SecureVault WHERE service_name = ?').get(serviceName) as any;
  if (!row) return null;
  return decryptToken(row.encrypted_token);
}

/**
 * List all vault entries (without decrypted tokens — for UI display).
 */
export function listSecrets(db: any): VaultEntry[] {
  return db.prepare('SELECT id, service_name, createdAt FROM SecureVault ORDER BY createdAt DESC').all() as VaultEntry[];
}

/**
 * Delete a secret by ID.
 */
export function deleteSecret(db: any, id: string): boolean {
  const result = db.prepare('DELETE FROM SecureVault WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Get multiple decrypted secrets by their service names.
 * Returns a map of service_name -> decrypted_token.
 * Used by pythonExecutor to inject vault keys into environment.
 */
export function getSecretsByServices(db: any, serviceNames: string[]): Record<string, string> {
  if (serviceNames.length === 0) return {};
  const placeholders = serviceNames.map(() => '?').join(',');
  const rows = db.prepare(`SELECT service_name, encrypted_token FROM SecureVault WHERE service_name IN (${placeholders})`).all(...serviceNames) as any[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.service_name] = decryptToken(row.encrypted_token);
  }
  return result;
}

