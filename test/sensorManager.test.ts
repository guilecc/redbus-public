import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Electron ──
const mockSend = vi.fn();

vi.mock('electron', () => {
  return {
    clipboard: {
      readText: () => (globalThis as any).__testClipboardText ?? '',
    },
    BrowserWindow: class { },
  };
});

// ── Mock child_process for ActiveWindowSensor ──
vi.mock('child_process', () => {
  const fn = (_cmd: string, _args: string[], _opts: any, cb: Function) => {
    const result = (globalThis as any).__testActiveWindowResult ?? '';
    cb(null, result, '');
  };
  return { default: { execFile: fn }, execFile: fn };
});

// ── Mock ocrWorker and screenMemoryService (used by VisionSensor) ──
vi.mock('../electron/services/ocrWorker', () => ({
  recognizeImage: vi.fn().mockResolvedValue(''),
  terminateOCR: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../electron/services/screenMemoryService', () => ({
  saveScreenCapture: vi.fn().mockReturnValue(true),
  pruneOldScreenMemory: vi.fn().mockReturnValue(0),
}));
vi.mock('../electron/services/accessibilitySensor', () => ({
  readAccessibilityTree: vi.fn().mockResolvedValue(null),
  flattenTreeToText: vi.fn().mockReturnValue(''),
}));

import {
  initSensorManager,
  toggleSensor,
  getSensorStatuses,
  getEnvironmentalContext,
  clearClipboardContext,
  _resetSensorState,
} from '../electron/services/sensorManager';
import { initializeDatabase, getAppSetting } from '../electron/database';

const mockMainWindow = {
  isDestroyed: vi.fn().mockReturnValue(false),
  webContents: { send: mockSend },
} as any;

function setClipboard(text: string) {
  (globalThis as any).__testClipboardText = text;
}

function setActiveWindow(appName: string, title: string) {
  (globalThis as any).__testActiveWindowResult = `${appName}||${title}`;
}

describe('SensorManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setClipboard('');
    (globalThis as any).__testActiveWindowResult = '';
    mockSend.mockClear();
    _resetSensorState();
    initSensorManager(mockMainWindow);
  });

  afterEach(() => {
    _resetSensorState();
    setClipboard('');
    (globalThis as any).__testActiveWindowResult = '';
    vi.useRealTimers();
  });

  // ── getSensorStatuses ──

  it('1. should list all sensors with initial state', () => {
    const statuses = getSensorStatuses();
    expect(statuses).toHaveLength(5);
    expect(statuses[0]).toEqual({ id: 'clipboard', label: 'Área de Transferência', enabled: false });
    expect(statuses[1]).toEqual({ id: 'activeWindow', label: 'Janela Ativa', enabled: false });
    expect(statuses[2]).toEqual({ id: 'vision', label: 'Olho Fotográfico', enabled: false });
    expect(statuses[3]).toEqual({ id: 'accessibility', label: 'Árvore de UI', enabled: false });
    expect(statuses[4]).toEqual({ id: 'microphone', label: 'Sensor Auditivo', enabled: false });
  });

  // ── toggleSensor ──

  it('2. should enable clipboard sensor', () => {
    toggleSensor('clipboard', true);
    const statuses = getSensorStatuses();
    expect(statuses[0].enabled).toBe(true);
  });

  it('3. should disable clipboard sensor and clear context', () => {
    toggleSensor('clipboard', true);
    setClipboard('Some long enough text for testing purposes');
    vi.advanceTimersByTime(2500);
    expect(getEnvironmentalContext().clipboardText).not.toBeNull();

    toggleSensor('clipboard', false);
    expect(getSensorStatuses()[0].enabled).toBe(false);
    expect(getEnvironmentalContext().clipboardText).toBeNull();
  });

  // ── Clipboard polling ──

  it('4. should detect new clipboard content after polling', () => {
    toggleSensor('clipboard', true);

    // Initially empty — no event
    vi.advanceTimersByTime(2500);
    expect(mockSend).not.toHaveBeenCalled();

    // Set clipboard text
    setClipboard('This is a new clipboard content that is long enough');
    vi.advanceTimersByTime(2500);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('sensor:clipboard-updated', expect.objectContaining({
      text: 'This is a new clipboard content that is long enough',
      capturedAt: expect.any(String),
    }));
  });

  it('5. should NOT emit event for same content (dedup via hash)', () => {
    setClipboard('This is a repeated clipboard content for testing');
    toggleSensor('clipboard', true);

    // Initial hash is set in startClipboardPolling — no event
    vi.advanceTimersByTime(2500);
    expect(mockSend).not.toHaveBeenCalled();

    // Same content on next poll
    vi.advanceTimersByTime(2500);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('6. should NOT emit event for short text (< 10 chars)', () => {
    toggleSensor('clipboard', true);
    setClipboard('short');
    vi.advanceTimersByTime(2500);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('7. should detect content change after initial content', () => {
    setClipboard('Initial clipboard content that is long enough');
    toggleSensor('clipboard', true);

    // Initial content is hashed on start — no event
    vi.advanceTimersByTime(2500);
    expect(mockSend).not.toHaveBeenCalled();

    // Change content
    setClipboard('New different clipboard content that is also long enough');
    vi.advanceTimersByTime(2500);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  // ── getEnvironmentalContext ──

  it('8. should return null context when sensor is disabled', () => {
    const ctx = getEnvironmentalContext();
    expect(ctx.clipboardText).toBeNull();
    expect(ctx.clipboardCapturedAt).toBeNull();
  });

  it('9. should return clipboard text in environmental context', () => {
    toggleSensor('clipboard', true);
    setClipboard('Context text for the Maestro prompt injection');
    vi.advanceTimersByTime(2500);

    const ctx = getEnvironmentalContext();
    expect(ctx.clipboardText).toBe('Context text for the Maestro prompt injection');
    expect(ctx.clipboardCapturedAt).toBeTruthy();
  });

  // ── clearClipboardContext ──

  it('10. should clear clipboard context on demand', () => {
    toggleSensor('clipboard', true);
    setClipboard('Text that will be cleared after consumption');
    vi.advanceTimersByTime(2500);
    expect(getEnvironmentalContext().clipboardText).not.toBeNull();

    clearClipboardContext();
    expect(getEnvironmentalContext().clipboardText).toBeNull();
  });

  // ══════════════════════════════════════
  // Active Window Sensor
  // ══════════════════════════════════════

  it('11. should enable/disable activeWindow sensor', () => {
    toggleSensor('activeWindow', true);
    expect(getSensorStatuses()[1].enabled).toBe(true);

    toggleSensor('activeWindow', false);
    expect(getSensorStatuses()[1].enabled).toBe(false);
  });

  it('12. should detect active window change after polling', () => {
    setActiveWindow('Microsoft Excel', 'Relatorio_Q1.xlsx');
    toggleSensor('activeWindow', true);
    vi.advanceTimersByTime(3500);

    expect(mockSend).toHaveBeenCalledWith('sensor:active-window-updated', expect.objectContaining({
      appName: 'Microsoft Excel',
      title: 'Relatorio_Q1.xlsx',
      updatedAt: expect.any(String),
    }));
  });

  it('13. should NOT emit when active window is unchanged (dedup)', () => {
    setActiveWindow('Safari', 'Google');
    toggleSensor('activeWindow', true);
    vi.advanceTimersByTime(3500);
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Same window again — no new event
    vi.advanceTimersByTime(3500);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('14. should emit when window changes', () => {
    setActiveWindow('Safari', 'Google');
    toggleSensor('activeWindow', true);
    vi.advanceTimersByTime(3500);
    expect(mockSend).toHaveBeenCalledTimes(1);

    setActiveWindow('Visual Studio Code', 'main.ts — redbus');
    vi.advanceTimersByTime(3500);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('15. should ignore self (Electron/RedBus)', () => {
    setActiveWindow('Electron', 'RedBus');
    toggleSensor('activeWindow', true);
    vi.advanceTimersByTime(3500);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('16. should return activeWindow in environmental context', () => {
    setActiveWindow('Outlook', 'Inbox — john@company.com');
    toggleSensor('activeWindow', true);
    vi.advanceTimersByTime(3500);

    const ctx = getEnvironmentalContext();
    expect(ctx.activeWindow).toEqual({ appName: 'Outlook', title: 'Inbox — john@company.com' });
    expect(ctx.activeWindowUpdatedAt).toBeTruthy();
  });

  it('17. should return null activeWindow when sensor is disabled', () => {
    const ctx = getEnvironmentalContext();
    expect(ctx.activeWindow).toBeNull();
    expect(ctx.activeWindowUpdatedAt).toBeNull();
  });

  it('18. should clear activeWindow context when disabled', () => {
    setActiveWindow('Firefox', 'GitHub');
    toggleSensor('activeWindow', true);
    vi.advanceTimersByTime(3500);
    expect(getEnvironmentalContext().activeWindow).not.toBeNull();

    toggleSensor('activeWindow', false);
    expect(getEnvironmentalContext().activeWindow).toBeNull();
  });

  // ══════════════════════════════════════
  // Vision Sensor (toggle only — OCR tested in screenMemoryService)
  // ══════════════════════════════════════

  it('19. should enable/disable vision sensor', () => {
    toggleSensor('vision', true);
    expect(getSensorStatuses()[2].enabled).toBe(true);

    toggleSensor('vision', false);
    expect(getSensorStatuses()[2].enabled).toBe(false);
  });

  // ══════════════════════════════════════
  // Accessibility Sensor (toggle + context)
  // ══════════════════════════════════════

  it('20. should enable/disable accessibility sensor', () => {
    toggleSensor('accessibility', true);
    expect(getSensorStatuses()[3].enabled).toBe(true);

    toggleSensor('accessibility', false);
    expect(getSensorStatuses()[3].enabled).toBe(false);
  });

  it('21. should return null accessibility context when disabled', () => {
    const ctx = getEnvironmentalContext();
    expect(ctx.accessibilityTree).toBeNull();
    expect(ctx.accessibilityTreeText).toBeNull();
  });

  it('22. should clear accessibility context when disabled', () => {
    toggleSensor('accessibility', true);
    // Context is null because readAccessibilityTree is mocked to return null
    toggleSensor('accessibility', false);
    expect(getEnvironmentalContext().accessibilityTree).toBeNull();
    expect(getEnvironmentalContext().accessibilityTreeText).toBeNull();
  });

  // ══════════════════════════════════════
  // Persistence (sensor state saved to DB)
  // ══════════════════════════════════════

  it('23. toggleSensor should persist state to AppSettings', () => {
    const db = initializeDatabase(':memory:');
    _resetSensorState();
    initSensorManager(mockMainWindow, db);

    toggleSensor('clipboard', true);
    expect(getAppSetting(db, 'sensor_clipboard_enabled')).toBe('1');

    toggleSensor('clipboard', false);
    expect(getAppSetting(db, 'sensor_clipboard_enabled')).toBe('0');

    db.close();
  });

  it('24. initSensorManager should restore sensor states from DB', () => {
    const db = initializeDatabase(':memory:');

    // Simulate a previous session that had sensors enabled
    db.prepare("INSERT OR REPLACE INTO AppSettings (key, value) VALUES ('sensor_clipboard_enabled', '1')").run();
    db.prepare("INSERT OR REPLACE INTO AppSettings (key, value) VALUES ('sensor_activeWindow_enabled', '1')").run();

    _resetSensorState();

    // All sensors should start disabled
    expect(getSensorStatuses()[0].enabled).toBe(false);
    expect(getSensorStatuses()[1].enabled).toBe(false);

    // Init with DB should restore persisted states
    initSensorManager(mockMainWindow, db);

    expect(getSensorStatuses()[0].enabled).toBe(true);  // clipboard restored
    expect(getSensorStatuses()[1].enabled).toBe(true);  // activeWindow restored
    expect(getSensorStatuses()[2].enabled).toBe(false); // vision was NOT saved, stays off

    db.close();
  });

  it('25. should NOT restore sensors when no DB is provided', () => {
    _resetSensorState();
    initSensorManager(mockMainWindow); // no db
    expect(getSensorStatuses()[0].enabled).toBe(false);
    expect(getSensorStatuses()[1].enabled).toBe(false);
  });
});

