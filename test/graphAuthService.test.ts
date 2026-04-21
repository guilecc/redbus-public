import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  safeStorage: null,
}));

vi.mock('../electron/services/activityLogger', () => ({
  logActivity: vi.fn(),
}));

import { initializeDatabase } from '../electron/database';
import {
  startDeviceCodeFlow,
  pollDeviceCodeToken,
  getAccessToken,
  refreshAccessToken,
  getAuthStatus,
  disconnectGraph,
  getMeId,
} from '../electron/services/graph/graphAuthService';
import { getSecretByService } from '../electron/services/vaultService';

function mockFetchOnce(responder: (url: string, init: any) => { ok: boolean; status?: number; json?: any; text?: string }) {
  (global as any).fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
    const r = responder(url, init);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: async () => r.json ?? {},
      text: async () => r.text ?? '',
    };
  });
}

describe('graphAuthService — Spec 11 §8 device code', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => { db = initializeDatabase(':memory:'); });
  afterEach(() => { db.close(); vi.restoreAllMocks(); });

  it('1. startDeviceCodeFlow devolve userCode + verificationUri', async () => {
    mockFetchOnce(() => ({
      ok: true,
      json: {
        user_code: 'ABCD-1234',
        device_code: 'dev-xyz',
        verification_uri: 'https://microsoft.com/devicelogin',
        expires_in: 900,
        interval: 5,
        message: 'go there',
      },
    }));
    const start = await startDeviceCodeFlow();
    expect(start.userCode).toBe('ABCD-1234');
    expect(start.deviceCode).toBe('dev-xyz');
    expect(start.verificationUri).toMatch(/devicelogin/);
    expect(start.expiresIn).toBe(900);
    expect(start.interval).toBe(5);
  });

  it('2. startDeviceCodeFlow lança em erro HTTP', async () => {
    mockFetchOnce(() => ({ ok: false, status: 400, text: 'invalid_client' }));
    await expect(startDeviceCodeFlow()).rejects.toThrow(/device_code failed: 400/);
  });

  it('3. pollDeviceCodeToken persiste tokens + hydrate /me e getAccessToken retorna', async () => {
    const calls: string[] = [];
    (global as any).fetch = vi.fn().mockImplementation(async (url: string) => {
      calls.push(url);
      if (url.includes('/oauth2/v2.0/token')) {
        return { ok: true, status: 200, json: async () => ({
          access_token: 'ACCESS_1',
          refresh_token: 'REFRESH_1',
          expires_in: 3600,
        }), text: async () => '' };
      }
      if (url.includes('/v1.0/me')) {
        return { ok: true, status: 200, json: async () => ({
          userPrincipalName: 'user@tenant.com',
          displayName: 'User Test',
          id: 'me-id-abc',
        }), text: async () => '' };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    });

    const ok = await pollDeviceCodeToken(db, {
      userCode: 'X', deviceCode: 'd', verificationUri: 'u', expiresIn: 10, interval: 0,
    });
    expect(ok).toBe(true);
    const status = getAuthStatus(db);
    expect(status.connected).toBe(true);
    expect(status.upn).toBe('user@tenant.com');
    expect(status.displayName).toBe('User Test');
    expect(getMeId(db)).toBe('me-id-abc');
    const token = await getAccessToken(db);
    expect(token).toBe('ACCESS_1');
  });

  it('4. refreshAccessToken troca refresh por novo access + persiste', async () => {
    // Setup — pre-populate refresh via poll
    (global as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'A1', refresh_token: 'R1', expires_in: 3600 }), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'me-id' }), text: async () => '' });
    await pollDeviceCodeToken(db, { userCode: 'x', deviceCode: 'd', verificationUri: 'u', expiresIn: 5, interval: 0 });

    // Now swap fetch for a refresh response
    (global as any).fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ access_token: 'A2', refresh_token: 'R2', expires_in: 3600 }),
      text: async () => '',
    });
    const ok = await refreshAccessToken(db);
    expect(ok).toBe(true);
    expect(getSecretByService(db, 'graph.access_token')).toBe('A2');
    expect(getSecretByService(db, 'graph.refresh_token')).toBe('R2');
  });

  it('5. refreshAccessToken retorna false quando não há refresh token', async () => {
    const ok = await refreshAccessToken(db);
    expect(ok).toBe(false);
  });

  it('6. getAccessToken retorna null quando desconectado', async () => {
    expect(await getAccessToken(db)).toBeNull();
    expect(getAuthStatus(db).connected).toBe(false);
  });

  it('7. disconnectGraph limpa tokens + settings + RawCommunications', async () => {
    (global as any).fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'me' }), text: async () => '' });
    await pollDeviceCodeToken(db, { userCode: 'x', deviceCode: 'd', verificationUri: 'u', expiresIn: 5, interval: 0 });
    expect(getAuthStatus(db).connected).toBe(true);

    disconnectGraph(db);
    expect(getAuthStatus(db).connected).toBe(false);
    expect(getMeId(db)).toBeNull();
    expect(getSecretByService(db, 'graph.access_token')).toBeNull();
  });
});

