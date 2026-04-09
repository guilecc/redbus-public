/**
 * NotificationService — Native OS notifications for the RedBus agent.
 *
 * Rules:
 * - Chat responses: only notify if app is NOT focused (user is in another app)
 * - Routine (cron) executions: ALWAYS notify (background by definition)
 * - Routine errors: ALWAYS notify
 * - Manual routine trigger: only notify if app is NOT focused
 */

import { Notification, BrowserWindow } from 'electron';

let _mainWindow: BrowserWindow | null = null;
let _focused = true;

/**
 * Initialize the notification service with the main window reference.
 * Sets up focus/blur/minimize listeners to track window state.
 */
export function initNotificationService(mainWindow: BrowserWindow): void {
  _mainWindow = mainWindow;
  _focused = mainWindow.isFocused();

  mainWindow.on('focus', () => { _focused = true; });
  mainWindow.on('blur', () => { _focused = false; });
  mainWindow.on('minimize', () => { _focused = false; });
  mainWindow.on('restore', () => { _focused = mainWindow.isFocused(); });
}

/**
 * Check if the app window is currently focused.
 */
export function isAppFocused(): boolean {
  return _focused;
}

/**
 * Send a native OS notification.
 * On click, brings the RedBus window to front.
 */
export function sendOSNotification(title: string, body: string): void {
  if (!Notification.isSupported()) {
    console.warn('[Notification] Not supported on this platform');
    return;
  }

  const notification = new Notification({
    title,
    body: body.length > 150 ? body.slice(0, 147) + '…' : body,
    silent: false,
  });

  notification.on('click', () => {
    if (_mainWindow) {
      if (_mainWindow.isMinimized()) _mainWindow.restore();
      _mainWindow.show();
      _mainWindow.focus();
    }
  });

  notification.show();
}

/**
 * Notify for a chat response — only if app is NOT focused.
 */
export function notifyChatResponse(reply: string): void {
  if (isAppFocused()) return;
  sendOSNotification('RedBus', reply.slice(0, 100));
}

/**
 * Notify for a routine execution — ALWAYS (cron is background).
 */
export function notifyRoutineSuccess(goal: string, summary?: string): void {
  const body = summary ? `${goal}: ${summary}` : goal;
  sendOSNotification('Rotina concluída', body.slice(0, 120));
}

/**
 * Notify for a routine error — ALWAYS.
 */
export function notifyRoutineError(goal: string, error: string): void {
  sendOSNotification('Rotina falhou', `${goal}: ${error}`.slice(0, 120));
}

/**
 * Notify for a manual routine trigger — only if app NOT focused.
 */
export function notifyManualRoutine(goal: string, summary?: string, isError = false): void {
  if (isAppFocused()) return;
  if (isError) {
    sendOSNotification('Execução manual falhou', `${goal}: ${summary || 'erro desconhecido'}`.slice(0, 120));
  } else {
    sendOSNotification('Execução manual concluída', `${goal}: ${summary || 'ok'}`.slice(0, 120));
  }
}

