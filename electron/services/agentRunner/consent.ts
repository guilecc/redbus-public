/**
 * HITL consent — lifted from `workerLoop._handleConsent` unchanged in shape.
 * The map is module-level because the IPC response handler lives in
 * `ipcHandlers.ts`; Spec 07 moves this into a hitl plugin that owns both
 * sides behind `before_tool_call`.
 */
import type { BrowserWindow } from 'electron';

const CONSENT_TIMEOUT_MS = 120_000;

type ConsentResponse = { status: string; human_verification_layer: string };

const consentResolvers = new Map<string, (response: ConsentResponse) => void>();
let consentCounter = 0;

export function resolveHumanConsent(requestId: string, approved: boolean): boolean {
  const resolver = consentResolvers.get(requestId);
  if (!resolver) return false;
  resolver({
    status: approved ? 'APPROVED' : 'DENIED',
    human_verification_layer: approved ? 'PASSED' : 'BLOCKED',
  });
  consentResolvers.delete(requestId);
  return true;
}

export async function handleConsent(
  toolCall: { id?: string; name: string; args: any },
  mainWindow?: BrowserWindow,
): Promise<{ output: string; denied: boolean; reason?: string }> {
  const requestId = `consent-${++consentCounter}`;
  const reason = toolCall.args?.reason_for_consent || 'Unknown reason';
  const action = toolCall.args?.intended_action || 'Unknown action';

  if (!mainWindow) {
    return { output: 'Human consent: {"status": "APPROVED", "human_verification_layer": "PASSED"}', denied: false };
  }

  mainWindow.webContents.send('hitl-consent-request', { requestId, reason, action });
  const response = await new Promise<ConsentResponse>((resolve) => {
    consentResolvers.set(requestId, resolve);
    setTimeout(() => {
      if (consentResolvers.has(requestId)) {
        consentResolvers.delete(requestId);
        resolve({ status: 'DENIED', human_verification_layer: 'TIMEOUT' });
      }
    }, CONSENT_TIMEOUT_MS);
  });
  return {
    output: `Human consent: ${JSON.stringify(response)}`,
    denied: response.status === 'DENIED',
    reason,
  };
}

