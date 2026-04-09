/**
 * ChannelManager — Manages Unified Executive Inbox channels.
 *
 * Architecture (v2 — Playwright + LLM):
 * - Authentication: BrowserWindow with isolated session partition for manual login.
 * - Extraction: Playwright headless captures DOM text → LLM Worker interprets messages.
 * - No BrowserView, no JS injection, no scrapers.
 * - Channels: Outlook, Teams (WhatsApp removed).
 */

import { BrowserWindow } from 'electron';
import { getAppSetting, setAppSetting } from '../database';
import { logActivity } from './activityLogger';
import type { ChannelId, ChannelState, ChannelStatus, UnifiedMessage } from './extractors/types';
import { checkSessionValid, shutdownPlaywright, suspendPlaywright, getPartitionName } from './playwrightService';

/* ── Channel Definitions ── */

const CHANNEL_CONFIGS: Record<ChannelId, { label: string; url: string }> = {
  outlook: { label: 'Outlook 365', url: 'https://outlook.office365.com/mail/' },
  teams: { label: 'Microsoft Teams', url: 'https://teams.cloud.microsoft/' },
};

/* ── State ── */

interface InternalChannelState {
  status: ChannelStatus;
  lastPollAt: string | null;
  lastMessages: UnifiedMessage[];
  errorMessage?: string;
}

const _channels = new Map<ChannelId, InternalChannelState>();
let _authWindows = new Map<ChannelId, BrowserWindow>();
let _mainWindow: BrowserWindow | null = null;
let _db: any = null;
let _suspended = false;



/* ── Initialization ── */

/**
 * Initialize the ChannelManager. Called once at app startup.
 * Auto-checks session validity for previously connected channels using Playwright.
 */
export function initChannelManager(mainWindow: BrowserWindow, db: any): void {
  _mainWindow = mainWindow;
  _db = db;

  for (const id of Object.keys(CHANNEL_CONFIGS) as ChannelId[]) {
    // Restore last known status from DB — show "connected" immediately if it was before
    const savedStatus = _db ? (getAppSetting(_db, `channel_${id}_status`) as ChannelStatus | null) : null;
    const initialStatus = savedStatus === 'connected' ? 'connected' : 'disconnected';
    _channels.set(id, {
      status: initialStatus,
      lastPollAt: null,
      lastMessages: [],
    });
    if (initialStatus === 'connected') {
      console.log(`[ChannelManager] ${id}: restored as connected from DB`);
    }
  }

  // Notify renderer of initial statuses immediately
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    for (const id of Object.keys(CHANNEL_CONFIGS) as ChannelId[]) {
      const state = _channels.get(id)!;
      _mainWindow.webContents.send('inbox:channel-status-changed', {
        channelId: id, status: state.status,
      });
    }
  }

  // Validate sessions in background (will downgrade to disconnected if expired)
  if (_db) {
    setTimeout(() => _autoCheckSessions(), 3000);
  }
}

/**
 * Auto-check sessions for previously connected channels.
 * Uses Playwright to verify if cookies are still valid.
 */
async function _autoCheckSessions(): Promise<void> {
  for (const id of Object.keys(CHANNEL_CONFIGS) as ChannelId[]) {
    try {
      const saved = getAppSetting(_db, `channel_${id}_status`);
      if (saved !== 'connected') continue;

      console.log(`[ChannelManager] Auto-checking session for ${id}...`);
      const valid = await checkSessionValid(id);

      if (valid) {
        _updateStatus(id, 'connected');
        console.log(`[ChannelManager] ✅ ${id}: session valid`);
      } else {
        _updateStatus(id, 'disconnected');
        console.log(`[ChannelManager] ⚠ ${id}: session expired, needs re-auth`);
      }
    } catch (err) {
      console.error(`[ChannelManager] Session check error for ${id}:`, err);
    }
  }
}

/* ── Authentication ── */

/**
 * Authenticate a channel.
 *
 * Flow:
 * 1. Use Playwright to open the service page and check what it sees.
 *    If it sees the inbox/chat → session valid, connect immediately.
 * 2. If it sees a login page → open BrowserWindow for manual login.
 *    Poll Playwright every 3s to detect when session becomes valid.
 *    Auto-close window when valid.
 */
export async function authenticateChannel(channelId: ChannelId): Promise<{ status: string }> {
  const config = CHANNEL_CONFIGS[channelId];
  if (!config || !_mainWindow) return { status: 'ERROR' };

  const state = _channels.get(channelId);
  if (!state) return { status: 'ERROR' };

  _updateStatus(channelId, 'authenticating');
  logActivity('inbox', `Autenticando canal: ${config.label}`);

  // ── Step 1: Check if already logged in via Playwright ──
  console.log(`[ChannelManager] 🔍 Checking existing session for ${channelId}...`);
  const alreadyValid = await checkSessionValid(channelId);
  if (alreadyValid) {
    console.log(`[ChannelManager] ✅ ${channelId}: session already valid — no login needed`);
    _updateStatus(channelId, 'connected');
    logActivity('inbox', `Canal conectado: ${config.label} (sessão existente)`);
    return { status: 'OK' };
  }

  // ── Step 2: Session expired — open BrowserWindow for manual login ──
  console.log(`[ChannelManager] 🔐 ${channelId}: needs login, opening window for URL: ${config.url}`);

  const existingWin = _authWindows.get(channelId);
  if (existingWin && !existingWin.isDestroyed()) existingWin.close();

  const partition = getPartitionName(channelId);
  const authWin = new BrowserWindow({
    width: 520, height: 700,
    parent: _mainWindow,
    modal: false,
    title: `Login — ${config.label}`,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition,
    },
  });
  _authWindows.set(channelId, authWin);

  authWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('prompt=none')) {
      return { action: 'allow', overrideBrowserWindowOptions: { show: false } };
    }
    return { action: 'allow' };
  });

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
  authWin.webContents.setUserAgent(UA);

  try {
    authWin.webContents.on('did-navigate', (event, url) => {
      console.log(`[ChannelManager] (${channelId} window) Navigated to: ${url}`);
    });
    authWin.webContents.on('did-navigate-in-page', (event, url) => {
      console.log(`[ChannelManager] (${channelId} window) Page redirect: ${url}`);
    });

    await authWin.loadURL(config.url);
    console.log(`[ChannelManager] ★ Login window opened for ${config.label}`);

    // ── Step 3: Poll Playwright every 7s to detect when login succeeds ──
    const authCompleted = await new Promise<boolean>((resolve) => {
      let resolved = false;
      let isChecking = false;

      const done = (success: boolean, reason: string) => {
        if (resolved) return;
        resolved = true;
        if (pollTimer) clearInterval(pollTimer);
        console.log(`[ChannelManager] ${success ? '✅' : '❌'} ${channelId}: ${reason}`);
        resolve(success);
      };

      const pollTimer = setInterval(async () => {
        if (resolved || authWin.isDestroyed() || isChecking) return;
        isChecking = true;
        try {
          console.log(`[ChannelManager] Polling checkSessionValid for ${channelId}...`);
          const valid = await checkSessionValid(channelId);
          if (valid) done(true, 'session validated by Playwright');
        } catch (e) {
          console.log(`[ChannelManager] Poll error: ${e}`);
        } finally {
          isChecking = false;
        }
      }, 7000); // 7s so it doesn't overlap with 4s wait in checkSessionValid

      // If user closes the window, do one final check
      authWin.on('closed', () => {
        if (resolved) return;
        setTimeout(async () => {
          if (resolved) return;
          try {
            const valid = await checkSessionValid(channelId);
            done(valid, valid ? 'valid after window close' : 'invalid after window close');
          } catch {
            done(false, 'check failed after window close');
          }
        }, 1500);
      });

      // Global timeout: 5 minutes
      setTimeout(() => done(false, 'timeout (5min)'), 5 * 60 * 1000);
    });

    if (!authWin.isDestroyed()) authWin.close();
    _authWindows.delete(channelId);

    if (authCompleted) {
      _updateStatus(channelId, 'connected');
      logActivity('inbox', `Canal conectado: ${config.label}`);
      return { status: 'OK' };
    } else {
      _updateStatus(channelId, 'disconnected');
      return { status: 'ERROR' };
    }
  } catch (err) {
    if (!authWin.isDestroyed()) authWin.close();
    _authWindows.delete(channelId);
    _updateStatus(channelId, 'error', String(err));
    console.error(`[ChannelManager] Auth failed for ${channelId}:`, err);
    return { status: 'ERROR' };
  }
}

/**
 * Disconnect a channel: stop polling, clear status.
 */
export function disconnectChannel(channelId: ChannelId): { status: string } {
  const state = _channels.get(channelId);
  if (!state) return { status: 'ERROR' };

  state.lastMessages = [];
  state.lastPollAt = null;
  _updateStatus(channelId, 'disconnected');
  logActivity('inbox', `Canal desconectado: ${CHANNEL_CONFIGS[channelId]?.label}`);
  return { status: 'OK' };
}

/* ── Sleep/Wake Protection ── */

/**
 * Pause all channel polling (called on system suspend).
 * With Playwright architecture, this simply stops timers (no BrowserView risk).
 */
export function suspendChannels(): void {
  _suspended = true;
  suspendPlaywright().catch(() => { });
  console.log('[ChannelManager] Suspended (system sleep)');
}

/**
 * Resume channels after system wake.
 */
export function resumeChannels(): void {
  _suspended = false;
  console.log('[ChannelManager] Resumed');
}

/* ── Extraction (Intelligent Browser Navigator) ── */

/**
 * Extract messages from a channel using the Intelligent Extractor.
 * The LLM actively controls Playwright via tool-calling (MCP-like),
 * navigating the inbox/chat to find and extract messages.
 */
export async function extractFromChannel(channelId: ChannelId, targetDate?: string): Promise<UnifiedMessage[]> {
  if (_suspended) return [];
  if (!_db) return [];

  const state = _channels.get(channelId);
  if (!state || state.status !== 'connected') return [];

  try {
    _updateStatus(channelId, 'extracting');
    const dateLabel = targetDate || new Date().toISOString().slice(0, 10);
    console.log(`[ChannelManager] ── Extracting ${channelId} for ${dateLabel} (Intelligent Navigator) ──`);

    const { intelligentExtract } = await import('./intelligentExtractor');
    const url = CHANNEL_CONFIGS[channelId].url;
    const messages = await intelligentExtract(_db, channelId, url, targetDate);

    state.lastMessages = messages;
    state.lastPollAt = new Date().toISOString();
    _updateStatus(channelId, 'connected');

    console.log(`[ChannelManager] Extracted ${messages.length} messages from ${channelId}`);
    logActivity('inbox', `${CHANNEL_CONFIGS[channelId].label}: ${messages.length} mensagens extraídas`);

    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('inbox:channel-updated', {
        channelId, messageCount: messages.length, lastPollAt: state.lastPollAt,
      });
    }

    return messages;
  } catch (err) {
    console.error(`[ChannelManager] Extraction error for ${channelId}:`, err);
    _updateStatus(channelId, 'connected');
    return [];
  }
}

export async function extractAll(targetDate?: string): Promise<UnifiedMessage[]> {
  const all: UnifiedMessage[] = [];
  for (const [channelId, state] of _channels.entries()) {
    if (state.status === 'connected') {
      all.push(...await extractFromChannel(channelId, targetDate));
    }
  }
  return all;
}

export async function forceExtractAll(targetDate?: string): Promise<UnifiedMessage[]> {
  return extractAll(targetDate);
}

/** Stub — reply injection not supported in Playwright architecture */
export async function injectDraftReply(_channelId: ChannelId, _sender: string, _draftText: string): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Reply injection not available in Playwright mode' };
}

/* ── Status ── */

function _updateStatus(channelId: ChannelId, status: ChannelStatus, errorMessage?: string): void {
  const state = _channels.get(channelId);
  if (!state) return;
  state.status = status;
  state.errorMessage = errorMessage;

  // Persist to DB
  if (_db) {
    try {
      setAppSetting(_db, `channel_${channelId}_status`, status);
    } catch { /* ignore */ }
  }

  // Notify renderer
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('inbox:channel-status-changed', {
      channelId,
      status,
      errorMessage,
    });
  }
}

/**
 * Get the current state of all channels.
 */
export function getChannelStatuses(): ChannelState[] {
  return (Object.keys(CHANNEL_CONFIGS) as ChannelId[]).map(id => {
    const config = CHANNEL_CONFIGS[id];
    const state = _channels.get(id);
    return {
      id,
      label: config.label,
      url: config.url,
      status: state?.status || 'disconnected',
      lastPollAt: state?.lastPollAt || null,
      lastMessages: state?.lastMessages || [],
      errorMessage: state?.errorMessage,
    };
  });
}

export function getCachedMessages(): UnifiedMessage[] {
  const all: UnifiedMessage[] = [];
  for (const state of _channels.values()) {
    if (state.status === 'connected') {
      all.push(...state.lastMessages);
    }
  }
  return all;
}

/* ── Cleanup ── */

export function shutdownChannelManager(): void {
  _channels.clear();
  shutdownPlaywright().catch(() => { });
  console.log('[ChannelManager] Shutdown complete');
}

/* ── Test Helpers ── */

export function _resetChannelManager(): void {
  _channels.clear();
  _mainWindow = null;
  _db = null;
  _suspended = false;
}
