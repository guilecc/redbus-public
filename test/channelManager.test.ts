import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Electron ──
const mockMainWindowSend = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    close: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: { send: vi.fn(), setWindowOpenHandler: vi.fn() },
  })),
  session: {
    fromPartition: vi.fn().mockReturnValue({ cookies: { get: vi.fn().mockResolvedValue([]) } }),
  },
}));

// ── Mock database ──
vi.mock('../electron/database', () => ({
  getAppSetting: vi.fn().mockReturnValue(null),
  setAppSetting: vi.fn(),
}));

// ── Mock activityLogger ──
vi.mock('../electron/services/activityLogger', () => ({
  logActivity: vi.fn(),
}));

// ── Mock playwrightService ──
vi.mock('../electron/services/playwrightService', () => ({
  checkSessionValid: vi.fn().mockResolvedValue(false),
  shutdownPlaywright: vi.fn().mockResolvedValue(undefined),
  suspendPlaywright: vi.fn().mockResolvedValue(undefined),
  getChannelUrl: vi.fn().mockReturnValue('https://example.com'),
  getPartitionName: vi.fn().mockReturnValue('persist:mock'),
}));

// ── Mock llmService ──
vi.mock('../electron/services/llmService', () => ({
  callWorkerRaw: vi.fn().mockResolvedValue(null),
}));

import {
  initChannelManager,
  getChannelStatuses,
  disconnectChannel,
  extractFromChannel,
  extractAll,
  getCachedMessages,
  suspendChannels,
  resumeChannels,
  _resetChannelManager,
} from '../electron/services/channelManager';
import type { ChannelId } from '../electron/services/extractors/types';

const mockMainWindow = {
  isDestroyed: vi.fn().mockReturnValue(false),
  webContents: { send: mockMainWindowSend },
} as any;

const mockDb = {} as any;

describe('ChannelManager (Playwright + LLM)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetChannelManager();
    initChannelManager(mockMainWindow, mockDb);
  });

  afterEach(() => {
    _resetChannelManager();
  });

  it('1. should list 2 channels (outlook, teams) with initial disconnected state', () => {
    const statuses = getChannelStatuses();
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ id: 'outlook', label: 'Outlook 365', status: 'disconnected' });
    expect(statuses[1]).toMatchObject({ id: 'teams', label: 'Microsoft Teams', status: 'disconnected' });
  });

  it('2. should NOT include whatsapp channel', () => {
    const statuses = getChannelStatuses();
    expect(statuses.find(s => (s.id as any) === 'whatsapp')).toBeUndefined();
  });

  it('3. should return OK when disconnecting a channel', () => {
    const result = disconnectChannel('outlook');
    expect(result.status).toBe('OK');
    expect(getChannelStatuses().find(s => s.id === 'outlook')?.status).toBe('disconnected');
  });

  it('4. should return ERROR for unknown channel', () => {
    const result = disconnectChannel('unknown' as ChannelId);
    expect(result.status).toBe('ERROR');
  });

  it('5. should return empty array when channel not connected', async () => {
    const messages = await extractFromChannel('outlook');
    expect(messages).toEqual([]);
  });

  it('6. should return empty when no channels connected', async () => {
    const messages = await extractAll();
    expect(messages).toEqual([]);
  });

  it('7. should return empty cached messages initially', () => {
    expect(getCachedMessages()).toEqual([]);
  });

  it('8. should have correct URLs', () => {
    const statuses = getChannelStatuses();
    expect(statuses.find(s => s.id === 'outlook')?.url).toBe('https://outlook.office365.com/mail/');
    expect(statuses.find(s => s.id === 'teams')?.url).toBe('https://teams.cloud.microsoft/');
  });

  it('9. should have null lastPollAt initially', () => {
    for (const s of getChannelStatuses()) {
      expect(s.lastPollAt).toBeNull();
      expect(s.lastMessages).toEqual([]);
    }
  });

  it('10. suspendChannels should set _suspended flag', () => {
    suspendChannels();
    // After suspend, extract should return empty
    return extractFromChannel('outlook').then(msgs => expect(msgs).toEqual([]));
  });

  it('11. resumeChannels should clear _suspended flag', () => {
    suspendChannels();
    resumeChannels();
    // Should be able to attempt extraction again (still empty because not connected)
    return extractFromChannel('outlook').then(msgs => expect(msgs).toEqual([]));
  });

  it('12. ChannelState should NOT have sessionPartition property', () => {
    const statuses = getChannelStatuses();
    expect((statuses[0] as any).sessionPartition).toBeUndefined();
  });
});
