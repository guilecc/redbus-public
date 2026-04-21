import { describe, it, expect, vi } from 'vitest';
import * as http from '../electron/plugins/http';
import { analyzeTranscriptFromText } from '../electron/services/audioAdapterService';

// Mock the low-level HTTP helper used by the provider plugins
vi.mock('../electron/plugins/http', () => ({
  fetchWithTimeout: vi.fn(),
}));

describe('AudioAdapterService - Analyze Transcript', () => {
  it('1. Should extract highlights and speakers matching TLDV schema', async () => {
    // Mocking an OpenAI response matching our new prompt
    const mockedResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            title: "Project Sync",
            date: "2026-03-18T10:00:00Z",
            platform: "local",
            duration: 1800,
            speakers: ["Alice", "Bob"],
            executive_summary: "Discussed the new UI.",
            decisions: ["Go with Dark Mode"],
            action_items: [{ owner: "Alice", task: "Design mocks", deadline: null }],
            highlights: [
              { text: "We should use Tailwind CSS", speaker: "Bob", type: "note" },
              { text: "Approved", speaker: "Alice", type: "decision" }
            ],
            meeting_url: null
          })
        }
      }]
    };

    vi.mocked(http.fetchWithTimeout).mockResolvedValueOnce({
      ok: true,
      json: async () => mockedResponse
    } as any);

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          roles: JSON.stringify({ utility: { model: 'gpt-4o-mini', thinkingLevel: 'off' } }),
          openAiKey: 'fake-key',
        }),
      }),
    };

    const result = await analyzeTranscriptFromText(mockDb, 'Alice: Hello. Bob: Hi.');

    expect(result.executive_summary).toBe("Discussed the new UI.");
    expect(result.speakers).toContain("Alice");
    expect(result.highlights).toHaveLength(2);
    expect(result.highlights[0].speaker).toBe("Bob");
  });
});
