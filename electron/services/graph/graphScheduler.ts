/**
 * graphScheduler — background poll loop for Mail + Teams.
 *
 * Spec 11 §9. Runs every 5min when the user is authenticated, fires
 * `comms:new-items` IPC events with the delta count, and sweeps TTL once
 * per day. Only one loop ever runs per main process.
 */

import type { BrowserWindow } from 'electron';
import { fetchRecentMessages } from './graphMailService';
import { fetchRecentChatMessages } from './graphTeamsService';
import { sweepOld, getLastTimestamp } from '../communicationsStore';
import { getAuthStatus } from './graphAuthService';
import { logActivity } from '../activityLogger';

const POLL_INTERVAL_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 24 * 3600_000;

let _timer: NodeJS.Timeout | null = null;
let _sweepTimer: NodeJS.Timeout | null = null;
let _inFlight = false;
let _db: any = null;
let _mainWindow: BrowserWindow | null = null;

export function initGraphScheduler(db: any, mainWindow: BrowserWindow | null): void {
  _db = db;
  _mainWindow = mainWindow;
  if (_timer) return;
  // First tick deferred 30s after boot to let the main window settle.
  _timer = setTimeout(_tick, 30_000);
  _sweepTimer = setInterval(_sweep, SWEEP_INTERVAL_MS);
  // Initial sweep shortly after startup
  setTimeout(_sweep, 60_000);
}

export function stopGraphScheduler(): void {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (_sweepTimer) { clearInterval(_sweepTimer); _sweepTimer = null; }
}

export async function pollNow(db?: any): Promise<{ ingested: number }> {
  const target = db || _db;
  if (!target) return { ingested: 0 };
  const before = Date.now();
  const n = await _runOnce(target);
  logActivity('inbox', `Graph poll manual: ${n} novos em ${Date.now() - before}ms`);
  return { ingested: n };
}

async function _tick(): Promise<void> {
  try {
    if (!_db || _inFlight) return;
    const status = getAuthStatus(_db);
    if (!status.connected) return;
    _inFlight = true;
    await _runOnce(_db);
  } catch (e) {
    logActivity('inbox', 'Graph scheduler: tick falhou', { error: String((e as any)?.message || e) });
  } finally {
    _inFlight = false;
    _timer = setTimeout(_tick, POLL_INTERVAL_MS);
  }
}

async function _runOnce(db: any): Promise<number> {
  let ingested = 0;
  try { ingested += await fetchRecentMessages(db); } catch { /* logged downstream */ }
  try { ingested += await fetchRecentChatMessages(db); } catch { /* logged downstream */ }
  if (ingested > 0 && _mainWindow && !_mainWindow.isDestroyed()) {
    const latestMail = getLastTimestamp(db, 'outlook');
    const latestTeams = getLastTimestamp(db, 'teams');
    const latestTimestamp = [latestMail, latestTeams].filter(Boolean).sort().pop() || new Date().toISOString();
    _mainWindow.webContents.send('comms:new-items', { count: ingested, latestTimestamp });
  }
  return ingested;
}

function _sweep(): void {
  if (!_db) return;
  try {
    // Keep 180d so calendar backfill of historical dates isn't wiped.
    const removed = sweepOld(_db, 180);
    if (removed > 0) logActivity('inbox', `Graph sweep TTL: ${removed} linhas antigas removidas`);
  } catch { /* ignore */ }
}

