/**
 * SensorManager — Gestão de sensores ambientais do RedBus.
 *
 * Sensores capturam contexto do ambiente do utilizador (clipboard, etc.)
 * e injetam-no no prompt do Maestro para dar proatividade ao agente.
 *
 * Arquitetura:
 *   - Cada sensor tem um ID, estado (ligado/desligado), e um intervalo de polling.
 *   - O SensorManager gere o ciclo de vida de todos os sensores.
 *   - Dados capturados ficam em memória RAM (curto prazo), não vão para SQLite.
 */

import { clipboard, BrowserWindow } from 'electron';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { recognizeImage, terminateOCR } from './ocrWorker';
import { saveScreenCapture, pruneOldScreenMemory } from './screenMemoryService';
import { readAccessibilityTree, flattenTreeToText } from './accessibilitySensor';
import type { AccessibilityTreeResult } from './accessibilitySensor';
import { getAppSetting, setAppSetting } from '../database';
import { initTldvSensor, startTldvPolling, stopTldvPolling, getTldvSyncStatus } from './sensors/tldvSensor';
import { logActivity } from './activityLogger';

/* ── Tipos ── */

export interface SensorStatus {
  id: string;
  label: string;
  enabled: boolean;
}

export interface ActiveWindowInfo {
  appName: string;
  title: string;
}

export interface EnvironmentalContext {
  clipboardText: string | null;
  clipboardCapturedAt: string | null;
  activeWindow: ActiveWindowInfo | null;
  activeWindowUpdatedAt: string | null;
  accessibilityTree: AccessibilityTreeResult | null;
  accessibilityTreeText: string | null;
}

/* ── Estado global em RAM ── */

const CLIPBOARD_POLL_INTERVAL_MS = 2000;
const CLIPBOARD_MIN_LENGTH = 10;
const ACTIVE_WINDOW_POLL_INTERVAL_MS = 3000;
const VISION_POLL_INTERVAL_MS = 10000;

let _clipboardEnabled = false;
let _clipboardTimer: ReturnType<typeof setInterval> | null = null;
let _lastClipboardHash: string | null = null;
let _clipboardText: string | null = null;
let _clipboardCapturedAt: string | null = null;

let _activeWindowEnabled = false;
let _activeWindowTimer: ReturnType<typeof setInterval> | null = null;
let _activeWindow: ActiveWindowInfo | null = null;
let _activeWindowUpdatedAt: string | null = null;
let _lastActiveWindowKey: string | null = null;

let _visionEnabled = false;
let _visionTimer: ReturnType<typeof setInterval> | null = null;
let _visionProcessing = false; // guard against overlapping captures
let _lastScreenText: string | null = null;
let _lastScreenCapturedAt: string | null = null;

let _accessibilityEnabled = false;
let _accessibilityTimer: ReturnType<typeof setInterval> | null = null;
let _accessibilityTree: AccessibilityTreeResult | null = null;
let _accessibilityTreeText: string | null = null;
let _accessibilityProcessing = false;
let _lastAccessibilityKey: string | null = null;

let _microphoneEnabled = false;

let _mainWindow: BrowserWindow | null = null;
let _db: any = null;

/* ── Hash helper ── */

function hashText(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

/* ── Clipboard Sensor ── */

function pollClipboard(): void {
  try {
    const text = clipboard.readText().trim();

    // Ignorar texto curto ou vazio
    if (!text || text.length < CLIPBOARD_MIN_LENGTH) return;

    const hash = hashText(text);
    if (hash === _lastClipboardHash) return; // Sem alteração

    _lastClipboardHash = hash;
    _clipboardText = text;
    _clipboardCapturedAt = new Date().toISOString();

    console.log(`[ClipboardSensor] Novo conteúdo detetado (${text.length} chars)`);
    logActivity('sensors', `Clipboard: novo conteúdo (${text.length} chars) — "${text.slice(0, 50)}${text.length > 50 ? '…' : ''}"`);

    // Emitir evento IPC para o React
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('sensor:clipboard-updated', {
        text: text.length > 500 ? text.slice(0, 500) + '…' : text,
        capturedAt: _clipboardCapturedAt,
      });
    }
  } catch (e) {
    // clipboard.readText() pode falhar em certos contextos — ignorar silenciosamente
  }
}

function startClipboardPolling(): void {
  if (_clipboardTimer) return; // Já está a correr
  // Ler estado inicial para não disparar evento com conteúdo pré-existente
  try {
    const initial = clipboard.readText().trim();
    if (initial && initial.length >= CLIPBOARD_MIN_LENGTH) {
      _lastClipboardHash = hashText(initial);
    }
  } catch { /* ignore */ }
  _clipboardTimer = setInterval(pollClipboard, CLIPBOARD_POLL_INTERVAL_MS);
  console.log('[ClipboardSensor] Polling iniciado');
}

function stopClipboardPolling(): void {
  if (_clipboardTimer) {
    clearInterval(_clipboardTimer);
    _clipboardTimer = null;
  }
  console.log('[ClipboardSensor] Polling parado');
}

/* ═══════════════════════════════════════════════
   Active Window Sensor — macOS via osascript
   ═══════════════════════════════════════════════ */

const OSASCRIPT = `
tell application "System Events"
  set fp to first application process whose frontmost is true
  set appName to name of fp
  try
    set winTitle to name of front window of fp
  on error
    set winTitle to ""
  end try
  return appName & "||" & winTitle
end tell`;

function pollActiveWindow(): void {
  execFile('osascript', ['-e', OSASCRIPT], { timeout: 2500 }, (err, stdout) => {
    if (err) return; // Accessibility permission may be missing — silent fail
    const raw = (stdout || '').trim();
    if (!raw) return;

    const sep = raw.indexOf('||');
    const appName = sep >= 0 ? raw.slice(0, sep).trim() : raw.trim();
    const title = sep >= 0 ? raw.slice(sep + 2).trim() : '';

    // Ignore self
    if (appName === 'Electron' || appName === 'RedBus') return;

    const key = `${appName}::${title}`;
    if (key === _lastActiveWindowKey) return; // No change

    _lastActiveWindowKey = key;
    _activeWindow = { appName, title };
    _activeWindowUpdatedAt = new Date().toISOString();

    console.log(`[ActiveWindowSensor] ${appName} — ${title || '(sem título)'}`);
    logActivity('sensors', `Active Window: ${appName} — ${title || '(sem título)'}`);

    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('sensor:active-window-updated', {
        appName, title, updatedAt: _activeWindowUpdatedAt,
      });
    }
  });
}

function startActiveWindowPolling(): void {
  if (_activeWindowTimer) return;
  _activeWindowTimer = setInterval(pollActiveWindow, ACTIVE_WINDOW_POLL_INTERVAL_MS);
  console.log('[ActiveWindowSensor] Polling iniciado');
}

function stopActiveWindowPolling(): void {
  if (_activeWindowTimer) {
    clearInterval(_activeWindowTimer);
    _activeWindowTimer = null;
  }
  console.log('[ActiveWindowSensor] Polling parado');
}

/* ═══════════════════════════════════════════════
   Accessibility Sensor — macOS AX Tree via JXA
   ═══════════════════════════════════════════════ */

const ACCESSIBILITY_POLL_INTERVAL_MS = 5000;

async function pollAccessibility(): Promise<void> {
  if (_accessibilityProcessing) return;
  _accessibilityProcessing = true;

  try {
    const result = await readAccessibilityTree();
    if (!result || result.nodeCount === 0) return;

    // Dedup: only update if app+window changed or tree structure changed
    const key = `${result.appName}::${result.windowTitle}::${result.nodeCount}`;
    if (key === _lastAccessibilityKey) return;

    _lastAccessibilityKey = key;
    _accessibilityTree = result;
    _accessibilityTreeText = flattenTreeToText(result.tree, 2000);

    console.log(`[AccessibilitySensor] ${result.appName} — ${result.nodeCount} nós`);
    logActivity('sensors', `Accessibility: ${result.appName} — ${result.nodeCount} nós`);

    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('sensor:accessibility-updated', {
        appName: result.appName,
        windowTitle: result.windowTitle,
        nodeCount: result.nodeCount,
        updatedAt: result.capturedAt,
      });
    }
  } catch (e) {
    // Silent fail
  } finally {
    _accessibilityProcessing = false;
  }
}

function startAccessibilityPolling(): void {
  if (_accessibilityTimer) return;
  _accessibilityTimer = setInterval(pollAccessibility, ACCESSIBILITY_POLL_INTERVAL_MS);
  console.log('[AccessibilitySensor] Polling iniciado');
}

function stopAccessibilityPolling(): void {
  if (_accessibilityTimer) {
    clearInterval(_accessibilityTimer);
    _accessibilityTimer = null;
  }
  console.log('[AccessibilitySensor] Polling parado');
}

/* ═══════════════════════════════════════════════
   Vision Sensor — Screen Capture + OCR
   ═══════════════════════════════════════════════ */

async function captureAndOCR(): Promise<void> {
  if (_visionProcessing) return; // Previous capture still running
  _visionProcessing = true;

  try {
    // Use macOS screencapture to capture the full screen to a temp file
    const tmpPath = require('path').join(require('os').tmpdir(), `redbus_cap_${Date.now()}.png`);

    await new Promise<void>((resolve, reject) => {
      execFile('screencapture', ['-x', '-C', '-t', 'png', tmpPath], { timeout: 5000 }, (err) => {
        if (err) reject(err); else resolve();
      });
    });

    // Read the image and send to OCR
    const fs = require('fs');
    if (!fs.existsSync(tmpPath)) return;
    const buffer = fs.readFileSync(tmpPath);
    fs.unlinkSync(tmpPath); // Cleanup temp file immediately

    const text = await recognizeImage(buffer);
    if (!text || text.length < 20) return;

    _lastScreenText = text;
    _lastScreenCapturedAt = new Date().toISOString();

    // Save to SQLite with FTS5
    if (_db) {
      const appInfo = _activeWindow;
      saveScreenCapture(_db, text, appInfo?.appName, appInfo?.title);
    }

    console.log(`[VisionSensor] OCR extraiu ${text.length} chars`);
    logActivity('sensors', `Vision (OCR): screenshot capturado — ${text.length} chars extraídos`);

    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('sensor:vision-captured', {
        textLength: text.length,
        activeApp: _activeWindow?.appName || '',
        capturedAt: _lastScreenCapturedAt,
      });
    }
  } catch (e) {
    // screencapture may fail if screen recording permission not granted — silent fail
    console.warn('[VisionSensor] Capture failed:', e);
  } finally {
    _visionProcessing = false;
  }
}

function startVisionPolling(): void {
  if (_visionTimer) return;
  _visionTimer = setInterval(captureAndOCR, VISION_POLL_INTERVAL_MS);
  console.log('[VisionSensor] Polling iniciado');
}

function stopVisionPolling(): void {
  if (_visionTimer) {
    clearInterval(_visionTimer);
    _visionTimer = null;
  }
  console.log('[VisionSensor] Polling parado');
}

/* ═══════════════════════════════════════════════
   API Pública
   ═══════════════════════════════════════════════ */

/**
 * Inicializar o SensorManager com a referência da janela principal.
 * Restaura automaticamente os estados dos sensores salvos no DB.
 */
export function initSensorManager(mainWindow: BrowserWindow, db?: any): void {
  _mainWindow = mainWindow;
  if (db) _db = db;

  // Restaurar estados persistidos dos sensores
  if (_db) {
    restoreSensorStates();

    // Initialize tl;dv sensor
    initTldvSensor(_db);
    const tldvStatus = getTldvSyncStatus();
    if (tldvStatus.hasApiKey) {
      startTldvPolling();
    }
  }
}

/**
 * Restaura os estados dos sensores a partir do AppSettings.
 */
function restoreSensorStates(): void {
  if (!_db) return;
  const sensorIds = ['clipboard', 'activeWindow', 'vision', 'accessibility', 'microphone'];
  for (const id of sensorIds) {
    try {
      const saved = getAppSetting(_db, `sensor_${id}_enabled`);
      if (saved === '1') {
        console.log(`[SensorManager] Restaurando sensor: ${id} → enabled`);
        toggleSensor(id, true);
      }
    } catch { /* DB may not be ready */ }
  }
}

/**
 * Ligar ou desligar um sensor pelo ID.
 * Persiste o estado no AppSettings para restauração no próximo boot.
 */
export function toggleSensor(sensorId: string, enabled: boolean): void {
  if (sensorId === 'clipboard') {
    _clipboardEnabled = enabled;
    if (enabled) {
      startClipboardPolling();
    } else {
      stopClipboardPolling();
      _clipboardText = null;
      _clipboardCapturedAt = null;
      _lastClipboardHash = null;
    }
  } else if (sensorId === 'activeWindow') {
    _activeWindowEnabled = enabled;
    if (enabled) {
      startActiveWindowPolling();
    } else {
      stopActiveWindowPolling();
      _activeWindow = null;
      _activeWindowUpdatedAt = null;
      _lastActiveWindowKey = null;
    }
  } else if (sensorId === 'vision') {
    _visionEnabled = enabled;
    if (enabled) {
      startVisionPolling();
      if (_db) pruneOldScreenMemory(_db);
    } else {
      stopVisionPolling();
      terminateOCR().catch(() => { });
      _lastScreenText = null;
      _lastScreenCapturedAt = null;
    }
  } else if (sensorId === 'accessibility') {
    _accessibilityEnabled = enabled;
    if (enabled) {
      startAccessibilityPolling();
    } else {
      stopAccessibilityPolling();
      _accessibilityTree = null;
      _accessibilityTreeText = null;
      _lastAccessibilityKey = null;
    }
  } else if (sensorId === 'microphone') {
    _microphoneEnabled = enabled;
    // Microphone capture happens in the renderer (MediaRecorder).
    // The backend only tracks the toggle state for persistence and UI sync.
    if (enabled) {
      console.log('[SensorManager] Microphone sensor enabled (capture runs in renderer)');
    } else {
      console.log('[SensorManager] Microphone sensor disabled');
    }
  }

  logActivity('sensors', `Sensor ${sensorId} ${enabled ? 'ligado' : 'desligado'}`);

  // Persistir estado no DB
  if (_db) {
    try {
      setAppSetting(_db, `sensor_${sensorId}_enabled`, enabled ? '1' : '0');
    } catch { /* DB may not be ready */ }
  }
}

/**
 * Reset all sensor state (for testing only).
 */
export function _resetSensorState(): void {
  stopClipboardPolling();
  _clipboardEnabled = false;
  _lastClipboardHash = null;
  _clipboardText = null;
  _clipboardCapturedAt = null;

  stopActiveWindowPolling();
  _activeWindowEnabled = false;
  _activeWindow = null;
  _activeWindowUpdatedAt = null;
  _lastActiveWindowKey = null;

  stopVisionPolling();
  _visionEnabled = false;
  _visionProcessing = false;
  _lastScreenText = null;
  _lastScreenCapturedAt = null;

  stopAccessibilityPolling();
  _accessibilityEnabled = false;
  _accessibilityTree = null;
  _accessibilityTreeText = null;
  _accessibilityProcessing = false;
  _lastAccessibilityKey = null;

  _microphoneEnabled = false;
}

/**
 * Obter o estado de todos os sensores.
 */
export function getSensorStatuses(): SensorStatus[] {
  return [
    { id: 'clipboard', label: 'Área de Transferência', enabled: _clipboardEnabled },
    { id: 'activeWindow', label: 'Janela Ativa', enabled: _activeWindowEnabled },
    { id: 'vision', label: 'Olho Fotográfico', enabled: _visionEnabled },
    { id: 'accessibility', label: 'Árvore de UI', enabled: _accessibilityEnabled },
    { id: 'microphone', label: 'Sensor Auditivo', enabled: _microphoneEnabled },
  ];
}

/**
 * Obter o contexto ambiental atual (para injeção no prompt do Maestro).
 */
export function getEnvironmentalContext(): EnvironmentalContext {
  return {
    clipboardText: _clipboardEnabled ? _clipboardText : null,
    clipboardCapturedAt: _clipboardEnabled ? _clipboardCapturedAt : null,
    activeWindow: _activeWindowEnabled ? _activeWindow : null,
    activeWindowUpdatedAt: _activeWindowEnabled ? _activeWindowUpdatedAt : null,
    accessibilityTree: _accessibilityEnabled ? _accessibilityTree : null,
    accessibilityTreeText: _accessibilityEnabled ? _accessibilityTreeText : null,
  };
}

/**
 * Limpar o contexto do clipboard (ex: após ser consumido pelo Maestro).
 */
export function clearClipboardContext(): void {
  _clipboardText = null;
  _clipboardCapturedAt = null;
}
