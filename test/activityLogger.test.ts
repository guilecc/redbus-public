import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock electron
const mockSend = vi.fn();
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn() },
}));

import { initializeDatabase } from '../electron/database';
import {
  initActivityLogger,
  logActivity,
  getRecentLogs,
  clearLogBuffer,
  _resetActivityLogger,
  type ActivityLogEntry,
} from '../electron/services/activityLogger';

describe('ActivityLogger', () => {
  let db: ReturnType<typeof initializeDatabase>;

  const mockMainWindow = {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: { send: mockSend },
  } as any;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    _resetActivityLogger();
    mockSend.mockClear();
    initActivityLogger(mockMainWindow, db);
  });

  afterEach(() => {
    _resetActivityLogger();
    db.close();
  });

  // ── Test 1: logActivity adds entry to buffer ──
  it('1. logActivity() deve adicionar entrada ao buffer', () => {
    logActivity('sensors', 'Clipboard: novo conteúdo capturado');

    const logs = getRecentLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].category).toBe('sensors');
    expect(logs[0].message).toBe('Clipboard: novo conteúdo capturado');
    expect(logs[0].id).toBeDefined();
    expect(logs[0].timestamp).toBeDefined();
  });

  // ── Test 2: logActivity with metadata ──
  it('2. logActivity() deve aceitar metadata opcional', () => {
    logActivity('meetings', 'Reunião salva', { title: 'Standup', duration: '30m' });

    const logs = getRecentLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).toEqual({ title: 'Standup', duration: '30m' });
  });

  // ── Test 3: Circular buffer keeps only last 500 ──
  it('3. Buffer circular deve manter apenas os últimos 500 eventos', () => {
    for (let i = 0; i < 520; i++) {
      logActivity('sensors', `Event ${i}`);
    }

    const logs = getRecentLogs(600);
    expect(logs).toHaveLength(500);
    // First entry should be event 20 (0-19 were evicted)
    expect(logs[0].message).toBe('Event 20');
    // Last entry should be event 519
    expect(logs[499].message).toBe('Event 519');
  });

  // ── Test 4: IPC event is emitted ──
  it('4. Deve emitir evento IPC activity:log-entry para o renderer', () => {
    logActivity('routines', 'Rotina disparada', { name: 'backup' });

    expect(mockSend).toHaveBeenCalledWith('activity:log-entry', expect.objectContaining({
      category: 'routines',
      message: 'Rotina disparada',
      metadata: { name: 'backup' },
    }));
  });

  // ── Test 5: IPC not emitted when mainWindow is destroyed ──
  it('5. Não deve emitir IPC se mainWindow estiver destruída', () => {
    mockMainWindow.isDestroyed.mockReturnValueOnce(true);
    logActivity('sensors', 'test');

    expect(mockSend).not.toHaveBeenCalled();
  });

  // ── Test 6: Critical logs are persisted in SQLite ──
  it('6. Logs críticos devem ser persistidos no SQLite', () => {
    logActivity('orchestrator', 'Living Spec criado', { specId: 'abc' }, true);

    const row = db.prepare('SELECT * FROM ActivityLog ORDER BY timestamp DESC LIMIT 1').get() as any;
    expect(row).toBeDefined();
    expect(row.category).toBe('orchestrator');
    expect(row.message).toBe('Living Spec criado');
    expect(JSON.parse(row.metadata_json)).toEqual({ specId: 'abc' });
  });

  // ── Test 7: Non-critical logs are NOT persisted ──
  it('7. Logs não-críticos NÃO devem ser persistidos no SQLite', () => {
    logActivity('sensors', 'Clipboard update');

    const row = db.prepare('SELECT * FROM ActivityLog').get();
    expect(row).toBeUndefined();
  });

  // ── Test 8: getRecentLogs respects limit ──
  it('8. getRecentLogs() deve respeitar o limite', () => {
    for (let i = 0; i < 10; i++) {
      logActivity('sensors', `Event ${i}`);
    }

    const logs = getRecentLogs(5);
    expect(logs).toHaveLength(5);
    // Should return the most recent 5
    expect(logs[0].message).toBe('Event 5');
    expect(logs[4].message).toBe('Event 9');
  });

  // ── Test 9: clearLogBuffer clears the buffer ──
  it('9. clearLogBuffer() deve limpar o buffer em memória', () => {
    logActivity('sensors', 'test1');
    logActivity('sensors', 'test2');
    expect(getRecentLogs()).toHaveLength(2);

    clearLogBuffer();
    expect(getRecentLogs()).toHaveLength(0);
  });

  // ── Test 10: Valid categories ──
  it('10. Deve aceitar todas as categorias válidas', () => {
    const categories = ['sensors', 'meetings', 'routines', 'proactivity', 'orchestrator'] as const;
    categories.forEach(cat => {
      logActivity(cat, `test ${cat}`);
    });

    const logs = getRecentLogs();
    expect(logs).toHaveLength(5);
    categories.forEach((cat, i) => {
      expect(logs[i].category).toBe(cat);
    });
  });
});

