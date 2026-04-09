import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Electron ──
vi.mock('electron', () => {
  return {
    BrowserWindow: vi.fn(),
    BrowserView: vi.fn(),
  };
});

// ── Mock channelManager ──
const mockExtractAll = vi.fn().mockResolvedValue([
  { channel: 'outlook', sender: 'CEO', subject: 'Urgente: Relatório Q1', preview: 'Preciso do relatório até amanhã', urgency: 'unknown', isUnread: true },
  { channel: 'teams', sender: 'Maria', preview: 'Reunião cancelada', urgency: 'unknown', isUnread: true },
]);

const mockGetCachedMessages = vi.fn().mockReturnValue([]);
const mockInjectDraftReply = vi.fn().mockResolvedValue({ success: true });

vi.mock('../electron/services/channelManager', () => ({
  extractAll: () => mockExtractAll(),
  getCachedMessages: () => mockGetCachedMessages(),
  injectDraftReply: (...args: any[]) => mockInjectDraftReply(...args),
}));

// ── Mock llmService ──
vi.mock('../electron/services/llmService', () => ({
  fetchWithTimeout: vi.fn(),
}));

// ── Mock notificationService ──
vi.mock('../electron/services/notificationService', () => ({
  sendOSNotification: vi.fn(),
}));

// ── Mock archiveService ──
vi.mock('../electron/services/archiveService', () => ({
  saveMessage: vi.fn(),
}));

// ── Mock activityLogger ──
vi.mock('../electron/services/activityLogger', () => ({
  logActivity: vi.fn(),
}));

// ── Mock uuid ──
vi.mock('uuid', () => ({
  v4: () => 'test-uuid-123',
}));

import {
  initBriefingEngine,
  generateBriefing,
  _resetBriefingEngine,
} from '../electron/services/briefingEngine';
import { fetchWithTimeout } from '../electron/services/llmService';

const mockMainWindow = {
  isDestroyed: vi.fn().mockReturnValue(false),
  webContents: { send: vi.fn() },
} as any;

describe('BriefingEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetBriefingEngine();
  });

  afterEach(() => {
    _resetBriefingEngine();
  });

  it('1. should return empty briefing when no messages', async () => {
    mockExtractAll.mockResolvedValueOnce([]);

    const mockDb = {
      prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null), run: vi.fn() }),
    };
    initBriefingEngine(mockDb, mockMainWindow);

    const result = await generateBriefing();

    expect(result.totalMessages).toBe(0);
    expect(result.urgentCount).toBe(0);
    expect(result.briefingText).toContain('Nenhuma mensagem');
    expect(result.messages).toEqual([]);
  });

  it('2. should return fallback briefing when LLM fails', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          workerModel: 'gemini-2.5-flash',
          googleKey: 'fake-key',
        }),
        run: vi.fn(),
      }),
    };
    initBriefingEngine(mockDb, mockMainWindow);

    // Mock LLM failure
    (fetchWithTimeout as any).mockRejectedValueOnce(new Error('LLM unavailable'));

    const result = await generateBriefing();

    expect(result.totalMessages).toBe(2);
    expect(result.briefingText).toContain('2 mensagens não lidas');
    expect(result.briefingText).toContain('Erro ao classificar');
  });

  it('3. should include all channels in briefing when available', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          workerModel: 'gemini-2.5-flash',
          googleKey: 'fake-key',
        }),
        run: vi.fn(),
      }),
    };
    initBriefingEngine(mockDb, mockMainWindow);

    // Simulate LLM response
    (fetchWithTimeout as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                messages: [
                  { channel: 'outlook', sender: 'CEO', urgency: 'high' },
                  { channel: 'teams', sender: 'Maria', urgency: 'low' },
                ],
                briefing: 'Você tem 2 mensagens. 1 urgente: CEO precisa do relatório Q1.'
              })
            }]
          }
        }]
      }),
    });

    const result = await generateBriefing();

    expect(result.totalMessages).toBe(2);
    expect(result.urgentCount).toBe(1);
    expect(result.briefingText).toContain('CEO');
  });

  it('4. should classify messages by urgency after LLM response', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          workerModel: 'gemini-2.5-flash',
          googleKey: 'fake-key',
        }),
        run: vi.fn(),
      }),
    };
    initBriefingEngine(mockDb, mockMainWindow);

    (fetchWithTimeout as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                messages: [
                  { channel: 'outlook', sender: 'CEO', urgency: 'high' },
                  { channel: 'teams', sender: 'Maria', urgency: 'low' },
                ],
                briefing: 'Test briefing.'
              })
            }]
          }
        }]
      }),
    });

    const result = await generateBriefing();

    const highMsg = result.messages.find(m => m.sender === 'CEO');
    expect(highMsg?.urgency).toBe('high');
    const lowMsg = result.messages.find(m => m.sender === 'Maria');
    expect(lowMsg?.urgency).toBe('low');
  });

  it('5. should emit briefing to renderer via IPC', async () => {
    mockExtractAll.mockResolvedValueOnce([]);
    const mockDb = {
      prepare: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null), run: vi.fn() }),
    };
    initBriefingEngine(mockDb, mockMainWindow);

    await generateBriefing();

    expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
      'inbox:briefing-ready',
      expect.objectContaining({ totalMessages: 0 })
    );
  });
});
