/**
 * Tests for tldvService + tldvSensor
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock fetch globally ──
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Mock uuid ──
vi.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

// ── Import after mocks ──
import { fetchRecentMeetings, fetchMeetingDetails } from '../electron/services/tldvService';
import {
  initTldvSensor,
  startTldvPolling,
  stopTldvPolling,
  forceSyncNow,
  getTldvSyncStatus,
  runTldvSyncCycle,
} from '../electron/services/sensors/tldvSensor';

/* ── Test data ── */

const MOCK_MEETINGS = [
  { id: 'mtg-1', name: 'Daily Standup', happenedAt: '2026-03-18T10:00:00Z', updated_at: '2026-03-18T10:30:00Z', duration: 1800, platform: 'zoom' },
  { id: 'mtg-2', name: 'Sprint Review', happenedAt: '2026-03-18T14:00:00Z', updated_at: '2026-03-18T15:00:00Z', duration: 3600, platform: 'teams' },
];

const MOCK_MEETING_DETAIL = {
  id: 'mtg-1', name: 'Daily Standup', happenedAt: '2026-03-18T10:00:00Z', updated_at: '2026-03-18T10:30:00Z',
  duration: 1800, platform: 'zoom', url: 'https://zoom.us/j/123',
  organizer: { name: 'Alice', email: 'alice@test.com' },
  invitees: [{ name: 'Bob', email: 'bob@test.com' }],
};

const MOCK_TRANSCRIPT = [
  { speaker: 'Alice', text: 'Good morning', start_time: 0, end_time: 3 },
  { speaker: 'Bob', text: 'Hey Alice', start_time: 3, end_time: 5 },
];

const MOCK_HIGHLIGHTS = [
  { id: 'h1', text: 'Need to fix the bug', speaker: 'Alice', start_time: 10, created_at: '2026-03-18T10:05:00Z', topic: { title: 'Bugs', summary: '' } },
];

/* ── tldvService tests ── */

describe('tldvService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('fetchRecentMeetings', () => {
    it('should parse meetings from API response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: MOCK_MEETINGS }),
      });

      const meetings = await fetchRecentMeetings('test-api-key');
      expect(meetings).toHaveLength(2);
      expect(meetings[0].id).toBe('mtg-1');
      expect(meetings[0].title).toBe('Daily Standup');
      expect(meetings[0].platform).toBe('zoom');
      expect(meetings[1].id).toBe('mtg-2');

      // Verify API call
      expect(mockFetch).toHaveBeenCalledOnce();
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('/v1alpha1/meetings');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-api-key']).toBe('test-api-key');
    });

    it('should pass limit and from params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await fetchRecentMeetings('key', { limit: 5, from: '2026-03-01T00:00:00Z' });
      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('limit=5');
      expect(url).toContain('from=2026-03-01');
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' });
      await expect(fetchRecentMeetings('bad-key')).rejects.toThrow('tl;dv API 401');
    });
  });

  describe('fetchMeetingDetails', () => {
    it('should fetch meeting + transcript + highlights in parallel', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_MEETING_DETAIL })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_TRANSCRIPT })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_HIGHLIGHTS });

      const details = await fetchMeetingDetails('key', 'mtg-1');
      expect(details.id).toBe('mtg-1');
      expect(details.title).toBe('Daily Standup');
      expect(details.speakers).toHaveLength(2);
      expect(details.transcript).toHaveLength(2);
      expect(details.transcript[0].speaker).toBe('Alice');
      expect(details.transcript[0].text).toBe('Good morning');
      expect(details.highlights).toHaveLength(1);
      expect(details.highlights[0].text).toBe('Need to fix the bug');
    });

    it('should handle missing transcript gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_MEETING_DETAIL })
        .mockRejectedValueOnce(new Error('404'))  // transcript fails
        .mockResolvedValueOnce({ ok: true, json: async () => [] });  // highlights ok

      const details = await fetchMeetingDetails('key', 'mtg-1');
      expect(details.transcript).toHaveLength(0);
      expect(details.highlights).toHaveLength(0);
    });
  });
});

/* ── tldvSensor tests ── */

describe('tldvSensor', () => {
  let mockDb: any;

  beforeEach(() => {
    mockFetch.mockReset();
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(null),
        run: vi.fn(),
      }),
    };
    initTldvSensor(mockDb);
    stopTldvPolling();
  });

  afterEach(() => {
    stopTldvPolling();
  });

  it('should return error when API key is not set', async () => {
    const result = await runTldvSyncCycle();
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key');
  });

  it('should sync meetings when API key is configured', async () => {
    const getMock = vi.fn().mockImplementation((key?: string) => {
      if (key === 'tldv_api_key') return { value: 'test-api-key' };
      return null;
    });
    const runMock = vi.fn();
    mockDb.prepare = vi.fn().mockReturnValue({ get: getMock, run: runMock });
    initTldvSensor(mockDb);

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [MOCK_MEETINGS[0]] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_MEETING_DETAIL })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_TRANSCRIPT })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_HIGHLIGHTS });

    const result = await runTldvSyncCycle();
    expect(result.success).toBe(true);
    expect(result.newMeetings).toBe(1);
    expect(runMock).toHaveBeenCalled();
  });

  it('should skip already saved meetings', async () => {
    const getMock = vi.fn().mockImplementation((key?: string) => {
      if (key === 'tldv_api_key') return { value: 'test-api-key' };
      if (typeof key === 'string' && key.includes('mtg-1')) return { id: 'existing' };
      return null;
    });
    mockDb.prepare = vi.fn().mockReturnValue({ get: getMock, run: vi.fn() });
    initTldvSensor(mockDb);

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [MOCK_MEETINGS[0]] }) });

    const result = await runTldvSyncCycle();
    expect(result.success).toBe(true);
    expect(result.newMeetings).toBe(0);
  });

  it('getTldvSyncStatus should report correct state', () => {
    const status = getTldvSyncStatus();
    expect(status.enabled).toBe(false);
    expect(status.syncing).toBe(false);
    expect(status.hasApiKey).toBe(false);
  });

  it('startTldvPolling / stopTldvPolling should toggle enabled', () => {
    const getMock = vi.fn().mockReturnValue({ value: 'test-key' });
    mockDb.prepare = vi.fn().mockReturnValue({ get: getMock, run: vi.fn() });
    initTldvSensor(mockDb);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });

    startTldvPolling();
    expect(getTldvSyncStatus().enabled).toBe(true);
    stopTldvPolling();
    expect(getTldvSyncStatus().enabled).toBe(false);
  });

  it('forceSyncNow should return error when no API key', async () => {
    const result = await forceSyncNow();
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key');
  });
});
