import { app, BrowserWindow, systemPreferences, session, desktopCapturer, ipcMain, screen, powerMonitor } from 'electron';
import path from 'path';
import { initializeDatabase, cleanupOldMemories } from './database';
import { setupIpcHandlers } from './ipcHandlers';
import { initStreamBus } from './services/streamBus';
import { saveMeetingMemory } from './services/meetingService';
import { startScheduler } from './services/schedulerService';
import { initNotificationService } from './services/notificationService';
import { initSensorManager } from './services/sensorManager';
import { startProactivityEngine } from './services/proactivityEngine';
import { initActivityLogger, logActivity } from './services/activityLogger';
import { loadBuiltins as loadPluginBuiltins } from './plugins/registry';
import { registerForgeBuiltins } from './plugins/forge-tools';
import { registerBrowserToolBuiltins } from './plugins/browser-tools';
import { syncSpawnSubagentTool } from './plugins/subagent-tool';
import { reindexSkills } from './services/skillsLoader';
import { initGraphScheduler, stopGraphScheduler } from './services/graph/graphScheduler';

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let db: ReturnType<typeof initializeDatabase> | null = null;

function createFloatingWidget() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    return;
  }

  widgetWindow = new BrowserWindow({
    width: 310,
    height: 200,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Position bottom-right of screen
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  widgetWindow.setPosition(width - 326, height - 214);

  if (process.env.VITE_DEV_SERVER_URL) {
    widgetWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/widget`);
  } else {
    widgetWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/widget' });
  }

  // Forward widget console output to main process terminal
  widgetWindow.webContents.on('console-message', (_e, _level, message) => {
    console.log(`[WidgetRenderer] ${message}`);
  });

  widgetWindow.on('closed', () => { widgetWindow = null; });
}

function destroyWidget() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.close();
    widgetWindow = null;
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';

  // Resolve icon path — used on Windows & Linux (macOS uses .icns from build config)
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', 'icons', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    icon: iconPath,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const } : {}),
    ...(!isMac ? { backgroundMaterial: 'mica' as const } : {}),
    backgroundColor: '#00000000',
    transparent: isMac,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for getUserMedia (microphone access)
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.commandLine.appendSwitch('ignore-certificate-errors');

// ── Stability switches for macOS ARM64 ──
// Disable background timer throttling — prevents V8 state corruption on sleep/wake
app.commandLine.appendSwitch('disable-background-timer-throttling');

app.whenReady().then(async () => {
  // Request microphone + screen recording permission on macOS
  if (process.platform === 'darwin') {
    try {
      const micStatus = systemPreferences.getMediaAccessStatus('microphone');
      console.log(`[Main] Microphone permission: ${micStatus}`);
      if (micStatus !== 'granted') {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        console.log(`[Main] Microphone permission ${granted ? 'granted' : 'denied'}`);
      }
      // Screen recording permission (needed for system audio capture)
      const screenStatus = systemPreferences.getMediaAccessStatus('screen');
      console.log(`[Main] Screen recording permission: ${screenStatus}`);
      // Note: macOS doesn't have askForMediaAccess('screen') — the permission dialog
      // is triggered automatically when desktopCapturer.getSources() is called.
    } catch (e) {
      console.warn('[Main] Failed to request media permissions:', e);
    }
  }

  // Allow media permissions (microphone, screen capture) in the renderer
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'notifications', 'display-capture'];
    console.log(`[Main] Permission request: ${permission} → ${allowed.includes(permission) ? 'ALLOW' : 'DENY'}`);
    callback(allowed.includes(permission));
  });

  // IPC: Get desktop capturer sources for system audio capture
  ipcMain.handle('desktop:get-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 }, // No thumbnails needed, just IDs
      });
      return {
        status: 'OK',
        data: sources.map(s => ({ id: s.id, name: s.name, type: s.id.startsWith('screen:') ? 'screen' : 'window' }))
      };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // Windows WASAPI loopback: handle getDisplayMedia requests with system audio
  if (process.platform === 'win32') {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      // Provide loopback audio (system audio capture) — Windows only
      callback({ audio: 'loopback' });
    });
  }

  // ── Widget IPC: floating recording widget ──
  ipcMain.handle('widget:open', () => {
    createFloatingWidget();
    return { status: 'OK' };
  });

  ipcMain.handle('widget:close', () => {
    destroyWidget();
    return { status: 'OK' };
  });

  // ── Window controls (Windows & Linux) ──
  ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    return { status: 'OK' };
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
    return { status: 'OK' };
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return { status: 'OK' };
  });

  ipcMain.handle('window:is-maximized', () => {
    const maximized = mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false;
    return { status: 'OK', data: maximized };
  });

  ipcMain.handle('window:get-platform', () => {
    return { status: 'OK', data: process.platform };
  });

  ipcMain.handle('widget:resize', (_e, w: number, h: number) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const [x, y] = widgetWindow.getPosition();
      const [oldW] = widgetWindow.getSize();
      // Keep right edge aligned
      widgetWindow.setBounds({ x: x + (oldW - w), y, width: w, height: h });
    }
    return { status: 'OK' };
  });

  // When meeting review data is ready, save to MeetingMemory and navigate to meetings view
  ipcMain.handle('meeting:show-review', (_e, data: any) => {
    destroyWidget();
    let meetingId: string | null = null;
    // Save the meeting analysis to the database
    if (db && data) {
      try {
        meetingId = saveMeetingMemory(db, {
          provider_used: data.provider_used || 'local',
          raw_transcript: data.raw_transcript || '',
          summary_json: data.summary_json || {},
        });
      } catch (err) {
        console.error('[main] Failed to save meeting from review:', err);
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      // Send meetingId so renderer navigates to meetings view with this meeting selected
      mainWindow.webContents.send('meeting:review-ready', { meetingId });
    }
    return { status: 'OK', data: { meetingId } };
  });

  db = initializeDatabase();

  loadPluginBuiltins();
  reindexSkills(db);
  registerForgeBuiltins(db);
  registerBrowserToolBuiltins();
  syncSpawnSubagentTool(db);

  createWindow();
  if (mainWindow) {
    initNotificationService(mainWindow);
    initSensorManager(mainWindow, db);
    initActivityLogger(mainWindow, db);

    // Forward renderer console messages to the ActivityConsole
    const LEVEL_LABELS = ['verbose', 'info', 'warn', 'error'];
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      // Strip internal Electron/Vite noise
      const src = sourceId ? sourceId.split('/').pop() ?? '' : '';
      const prefix = LEVEL_LABELS[level] ? `[${LEVEL_LABELS[level]}]` : '';
      const location = src ? ` (${src}:${line})` : '';
      logActivity('console', `${prefix} ${message}${location}`.trim());
    });
  }

  if (mainWindow) initStreamBus(mainWindow);
  setupIpcHandlers(db, mainWindow);
  startScheduler(db, mainWindow);

  // Spec 11 — Microsoft Graph background poll (mail + teams)
  if (db) initGraphScheduler(db, mainWindow);

  // Start the Proactivity Engine (Subconscious)
  if (mainWindow && db) {
    startProactivityEngine(db, mainWindow);
  }

  // Data retention: cleanup on boot + every 12 hours
  if (db) {
    const _db = db;
    cleanupOldMemories(_db);
    setInterval(() => cleanupOldMemories(_db), 12 * 60 * 60 * 1000);
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // ── Sleep/Wake Protection ──


  // ── Global crash recovery ──
  // Handle renderer process crashes gracefully instead of letting them cascade
  app.on('render-process-gone', (_event, webContents, details) => {
    console.error(`[Main] Renderer process gone: ${details.reason} (exitCode: ${details.exitCode})`);
    // Don't crash the whole app — log and continue
    if (details.reason === 'crashed' || details.reason === 'killed') {
      console.warn('[Main] A renderer process crashed — app continues running');
    }
  });

  app.on('child-process-gone', (_event, details) => {
    console.error(`[Main] Child process gone: ${details.type} — ${details.reason}`);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Graceful shutdown: close database + cleanup audio routing
app.on('will-quit', () => {
  try { stopGraphScheduler(); } catch { /* ignore */ }
  // 1. Flush WAL and close SQLite cleanly
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      console.log('[Shutdown] Database closed cleanly (WAL flushed).');
    } catch (e) {
      console.error('[Shutdown] Database close failed:', e);
    }
    db = null;
  }

  // 2. Restore audio routing
  try {
    const { cleanupAudioRouting } = require('./services/audioRoutingService');
    cleanupAudioRouting();
  } catch { /* helper may not be available */ }
});
