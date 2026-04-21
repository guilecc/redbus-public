/**
 * graphAuthService — Microsoft Graph OAuth 2.0 Device Code flow.
 *
 * Spec 11 §8. No embedded webview; UI shows `userCode` + opens the MS
 * verification URL via `shell.openExternal`. Tokens persist in SecureVault.
 */

import { getSecretByService, saveSecret, deleteSecret } from '../vaultService';
import { getAppSetting, setAppSetting } from '../../database';
import { logActivity } from '../activityLogger';

// Public client — multi-tenant app registration. ID is not secret.
// TODO: replace with production app registration before release.
export const GRAPH_CLIENT_ID = process.env.REDBUS_GRAPH_CLIENT_ID || '14d82eec-204b-4c2f-b7e8-296a70dab67e';
const TENANT = 'common';
export const GRAPH_SCOPES = 'offline_access User.Read Mail.Read Chat.Read ChatMessage.Read';

const DEVICE_CODE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const LOGOUT_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/logout`;

const SVC_ACCESS = 'graph.access_token';
const SVC_REFRESH = 'graph.refresh_token';
const SK_EXPIRES_AT = 'graph.expires_at';
const SK_UPN = 'graph.account.upn';
const SK_NAME = 'graph.account.displayName';
const SK_TENANT = 'graph.tenant_id';
const SK_ACCOUNT_ID = 'graph.account.id';

export interface DeviceCodeStart {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message?: string;
}

export interface GraphAuthStatus {
  connected: boolean;
  upn?: string;
  displayName?: string;
  expiresAt?: string;
}

let _pendingPoll: Promise<boolean> | null = null;

export async function startDeviceCodeFlow(): Promise<DeviceCodeStart> {
  const body = new URLSearchParams({ client_id: GRAPH_CLIENT_ID, scope: GRAPH_SCOPES });
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res.ok) throw new Error(`device_code failed: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return {
    userCode: data.user_code,
    deviceCode: data.device_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval || 5,
    message: data.message,
  };
}

export async function pollDeviceCodeToken(db: any, start: DeviceCodeStart): Promise<boolean> {
  if (_pendingPoll) return _pendingPoll;
  _pendingPoll = (async () => {
    const deadline = Date.now() + start.expiresIn * 1000;
    let interval = Math.max(3, start.interval);
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval * 1000));
      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: GRAPH_CLIENT_ID,
        device_code: start.deviceCode,
      });
      const res = await fetch(TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok && data.access_token) {
        await _persistTokens(db, data);
        await _hydrateAccountInfo(db, data.access_token);
        logActivity('inbox', 'Microsoft 365: conectado via device code');
        return true;
      }
      const err = String(data.error || '');
      if (err === 'authorization_pending') continue;
      if (err === 'slow_down') { interval += 5; continue; }
      return false;
    }
    return false;
  })();
  try { return await _pendingPoll; } finally { _pendingPoll = null; }
}

export async function getAccessToken(db: any): Promise<string | null> {
  const access = getSecretByService(db, SVC_ACCESS);
  if (!access) return null;
  const expiresAt = Number(getAppSetting(db, SK_EXPIRES_AT) || '0');
  if (Date.now() + 120_000 >= expiresAt) {
    const ok = await refreshAccessToken(db);
    if (!ok) return null;
    return getSecretByService(db, SVC_ACCESS);
  }
  return access;
}

export async function refreshAccessToken(db: any): Promise<boolean> {
  const refresh = getSecretByService(db, SVC_REFRESH);
  if (!refresh) return false;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: GRAPH_CLIENT_ID,
    refresh_token: refresh,
    scope: GRAPH_SCOPES,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res.ok) { logActivity('inbox', `Microsoft 365: refresh falhou (${res.status})`); return false; }
  const data: any = await res.json();
  if (!data.access_token) return false;
  await _persistTokens(db, data);
  return true;
}

export function getAuthStatus(db: any): GraphAuthStatus {
  const access = getSecretByService(db, SVC_ACCESS);
  if (!access) return { connected: false };
  const expiresAt = Number(getAppSetting(db, SK_EXPIRES_AT) || '0');
  return {
    connected: true,
    upn: getAppSetting(db, SK_UPN) || undefined,
    displayName: getAppSetting(db, SK_NAME) || undefined,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
  };
}

export function disconnectGraph(db: any): void {
  try { deleteSecret(db, SVC_ACCESS); } catch { }
  try { deleteSecret(db, SVC_REFRESH); } catch { }
  try { setAppSetting(db, SK_EXPIRES_AT, '0'); } catch { }
  try { setAppSetting(db, SK_UPN, ''); } catch { }
  try { setAppSetting(db, SK_NAME, ''); } catch { }
  try { setAppSetting(db, SK_TENANT, ''); } catch { }
  try { setAppSetting(db, SK_ACCOUNT_ID, ''); } catch { }
  try { db.prepare('DELETE FROM RawCommunications').run(); } catch { }
  logActivity('inbox', 'Microsoft 365: desconectado');
}

export function getLogoutUrl(): string { return LOGOUT_URL; }

export function getMeId(db: any): string | null {
  return getAppSetting(db, SK_ACCOUNT_ID) || null;
}

async function _persistTokens(db: any, data: any): Promise<void> {
  saveSecret(db, SVC_ACCESS, SVC_ACCESS, data.access_token);
  if (data.refresh_token) saveSecret(db, SVC_REFRESH, SVC_REFRESH, data.refresh_token);
  const expiresIn = Number(data.expires_in || 3600);
  setAppSetting(db, SK_EXPIRES_AT, String(Date.now() + expiresIn * 1000));
}

async function _hydrateAccountInfo(db: any, accessToken: string): Promise<void> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const me: any = await res.json();
    if (me.userPrincipalName) setAppSetting(db, SK_UPN, me.userPrincipalName);
    if (me.displayName) setAppSetting(db, SK_NAME, me.displayName);
    if (me.id) setAppSetting(db, SK_ACCOUNT_ID, me.id);
    // Mirror identity into UserProfile so digestService can address the user
    // correctly. Only writes when the stored fields are empty — preserves any
    // manual override from legacy installs that collected this in onboarding.
    try { _syncProfessionalIdentity(db, me.displayName, me.userPrincipalName); } catch { /* ignore */ }
  } catch { /* ignore */ }
}

function _syncProfessionalIdentity(db: any, displayName?: string, upn?: string): void {
  const name = (displayName || '').trim();
  const email = (upn || '').trim();
  if (!name && !email) return;
  const row = db.prepare(
    `SELECT professional_name, professional_email FROM UserProfile WHERE id = 'default'`
  ).get() as { professional_name?: string; professional_email?: string } | undefined;
  const nextName = row?.professional_name?.trim() ? row.professional_name : name;
  const nextEmail = row?.professional_email?.trim() ? row.professional_email : email;
  db.prepare(`
    INSERT INTO UserProfile (id, name, role, preferences, system_prompt_compiled, professional_name, professional_email, professional_aliases)
    VALUES ('default',
            COALESCE((SELECT name FROM UserProfile WHERE id='default'), ''),
            COALESCE((SELECT role FROM UserProfile WHERE id='default'), ''),
            COALESCE((SELECT preferences FROM UserProfile WHERE id='default'), ''),
            COALESCE((SELECT system_prompt_compiled FROM UserProfile WHERE id='default'), ''),
            ?, ?,
            COALESCE((SELECT professional_aliases FROM UserProfile WHERE id='default'), ''))
    ON CONFLICT(id) DO UPDATE SET
      professional_name = excluded.professional_name,
      professional_email = excluded.professional_email,
      updated_at = CURRENT_TIMESTAMP
  `).run(nextName, nextEmail);
}

