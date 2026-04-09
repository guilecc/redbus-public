import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Electron (factory must not reference outer vars — vi.mock is hoisted) ──
vi.mock('electron', () => {
  const instances: any[] = [];
  class MockNotification {
    title: string;
    body: string;
    silent: boolean;
    static isSupported = vi.fn().mockReturnValue(true);
    static _instances = instances;
    show = vi.fn();
    on = vi.fn();
    constructor(opts: any) {
      this.title = opts.title;
      this.body = opts.body;
      this.silent = opts.silent;
      instances.push(this);
    }
  }
  return { Notification: MockNotification, BrowserWindow: class { } };
});

// Access the mock AFTER vi.mock hoisting
import { Notification } from 'electron';
const MockNotification = Notification as any;

const mockMainWindow = {
  isFocused: vi.fn().mockReturnValue(true),
  isMinimized: vi.fn().mockReturnValue(false),
  on: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  restore: vi.fn(),
};

import {
  initNotificationService,
  isAppFocused,
  sendOSNotification,
  notifyChatResponse,
  notifyRoutineSuccess,
  notifyRoutineError,
  notifyManualRoutine,
} from '../electron/services/notificationService';

function lastInstance(): any {
  const instances = MockNotification._instances;
  return instances[instances.length - 1];
}

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockNotification._instances.length = 0;
    MockNotification.isSupported.mockReturnValue(true);
    mockMainWindow.isFocused.mockReturnValue(true);
    mockMainWindow.on.mockReset();
    initNotificationService(mockMainWindow as any);
    // Simulate focused state
    const focusCb = mockMainWindow.on.mock.calls.find((c: any) => c[0] === 'focus');
    if (focusCb) focusCb[1]();
  });

  // ── isAppFocused ──

  it('1. should report focused state correctly', () => {
    expect(isAppFocused()).toBe(true);
    const blurCb = mockMainWindow.on.mock.calls.find((c: any) => c[0] === 'blur');
    blurCb[1]();
    expect(isAppFocused()).toBe(false);
    const focusCb = mockMainWindow.on.mock.calls.find((c: any) => c[0] === 'focus');
    focusCb[1]();
    expect(isAppFocused()).toBe(true);
  });

  it('2. should report unfocused on minimize', () => {
    const minimizeCb = mockMainWindow.on.mock.calls.find((c: any) => c[0] === 'minimize');
    minimizeCb[1]();
    expect(isAppFocused()).toBe(false);
  });

  // ── sendOSNotification ──

  it('3. should create and show a Notification when supported', () => {
    sendOSNotification('Test Title', 'Test Body');
    const inst = lastInstance();
    expect(inst).toBeDefined();
    expect(inst.title).toBe('Test Title');
    expect(inst.body).toBe('Test Body');
    expect(inst.show).toHaveBeenCalledTimes(1);
    expect(inst.on).toHaveBeenCalledWith('click', expect.any(Function));
  });

  it('4. should NOT create Notification when not supported', () => {
    MockNotification.isSupported.mockReturnValue(false);
    sendOSNotification('Title', 'Body');
    expect(MockNotification._instances).toHaveLength(0);
  });

  it('5. should truncate body longer than 150 chars', () => {
    const longBody = 'a'.repeat(200);
    sendOSNotification('Title', longBody);
    const inst = lastInstance();
    expect(inst.body).toBe('a'.repeat(147) + '…');
  });

  // ── notifyChatResponse ──

  it('6. should NOT notify chat response when app is focused', () => {
    notifyChatResponse('Hello user');
    expect(MockNotification._instances).toHaveLength(0);
  });

  it('7. should notify chat response when app is NOT focused', () => {
    const blurCb = mockMainWindow.on.mock.calls.find((c: any) => c[0] === 'blur');
    blurCb[1]();
    notifyChatResponse('Hello user, your data is ready');
    expect(MockNotification._instances).toHaveLength(1);
    expect(lastInstance().show).toHaveBeenCalledTimes(1);
  });

  // ── notifyRoutineSuccess ──

  it('8. should ALWAYS notify routine success (even when focused)', () => {
    notifyRoutineSuccess('Check email', 'Found 3 new emails');
    expect(MockNotification._instances).toHaveLength(1);
    expect(lastInstance().title).toBe('Rotina concluída');
  });

  // ── notifyRoutineError ──

  it('9. should ALWAYS notify routine errors', () => {
    notifyRoutineError('Fetch Jira', 'timeout after 30s');
    expect(MockNotification._instances).toHaveLength(1);
    expect(lastInstance().title).toBe('Rotina falhou');
  });

  // ── notifyManualRoutine ──

  it('10. should NOT notify manual routine when app is focused', () => {
    notifyManualRoutine('Fetch data', 'ok', false);
    expect(MockNotification._instances).toHaveLength(0);
  });

  it('11. should notify manual routine when app is NOT focused', () => {
    const blurCb = mockMainWindow.on.mock.calls.find((c: any) => c[0] === 'blur');
    blurCb[1]();
    notifyManualRoutine('Fetch data', 'ok', false);
    expect(MockNotification._instances).toHaveLength(1);
  });
});

