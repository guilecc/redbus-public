/**
 * tldvService — REST client for the tl;dv API.
 *
 * Docs: https://doc.tldv.io
 * Base URL: https://pasta.tldv.io
 * Auth: x-api-key header
 */

const TLDV_BASE_URL = 'https://pasta.tldv.io';

/* ── Types ── */

export interface TldvMeetingSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  meetingUrl?: string;
  duration?: number;
  status?: string;
  platform?: string;
}

export interface TldvSpeaker {
  id: string;
  name: string;
}

export interface TldvTranscriptEntry {
  speaker: string;
  speakerId?: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface TldvHighlightTopic {
  title: string;
  summary?: string;
}

export interface TldvHighlight {
  id: string;
  text: string;
  createdAt: string;
  speaker?: string;
  startTime?: number;
  source?: string;
  topic?: TldvHighlightTopic;
}

export interface TldvParticipant {
  name: string;
  email?: string;
}

export interface TldvMeetingDetails {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  meetingUrl?: string;
  duration?: number;
  status?: string;
  platform?: string;
  organizer?: TldvParticipant;
  invitees?: TldvParticipant[];
  speakers: TldvSpeaker[];
  transcript: TldvTranscriptEntry[];
  highlights: TldvHighlight[];
}

/* ── API Client ── */

async function tldvFetch(apiKey: string, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${TLDV_BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000); // 15s timeout
  try {
    const res = await fetch(url.toString(), {
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`tl;dv API ${res.status}: ${body}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch recent meetings (paginated).
 * @param apiKey tl;dv API key
 * @param opts.limit max results (default 20)
 * @param opts.from ISO date to filter meetings after
 */
export async function fetchRecentMeetings(
  apiKey: string,
  opts?: { limit?: number; from?: string; page?: number }
): Promise<TldvMeetingSummary[]> {
  const params: Record<string, string> = {};
  if (opts?.limit) params.limit = String(opts.limit);
  if (opts?.from) params.from = opts.from;
  if (opts?.page) params.page = String(opts.page);
  // Only fetch meetings where the authenticated user participated
  params.onlyParticipated = 'true';

  const data = await tldvFetch(apiKey, '/v1alpha1/meetings', params);
  // API returns { results: [...], next_page: ... } or just an array
  const meetings = Array.isArray(data) ? data : (data.results || data.data || []);
  return meetings.map((m: any) => ({
    id: m.id,
    title: m.name || m.title || 'Sem título',
    createdAt: m.happenedAt || m.created_at || m.createdAt || '',
    updatedAt: m.updated_at || m.updatedAt || '',
    meetingUrl: m.url || m.meeting_url || m.meetingUrl || '',
    duration: m.duration || 0,
    status: m.status || '',
    platform: m.platform || '',
  }));
}

/**
 * Fetch full meeting details including transcript and highlights.
 */
export async function fetchMeetingDetails(
  apiKey: string,
  meetingId: string
): Promise<TldvMeetingDetails> {
  // Fetch meeting + transcript + highlights in parallel
  const [meeting, transcriptData, highlightsData] = await Promise.all([
    tldvFetch(apiKey, `/v1alpha1/meetings/${meetingId}`),
    tldvFetch(apiKey, `/v1alpha1/meetings/${meetingId}/transcript`).catch(() => []),
    tldvFetch(apiKey, `/v1alpha1/meetings/${meetingId}/highlights`).catch(() => []),
  ]);

  const rawTranscript = Array.isArray(transcriptData) ? transcriptData : (transcriptData.results || transcriptData.data || []);
  const rawHighlights = Array.isArray(highlightsData) ? highlightsData : (highlightsData.results || highlightsData.data || []);

  // Build speakers from organizer + invitees (API doesn't return a speakers array)
  const allParticipants: TldvParticipant[] = [];
  if (meeting.organizer) allParticipants.push({ name: meeting.organizer.name || meeting.organizer.email || '', email: meeting.organizer.email });
  if (meeting.invitees) {
    for (const inv of meeting.invitees) {
      allParticipants.push({ name: inv.name || inv.email || '', email: inv.email });
    }
  }
  const speakers: TldvSpeaker[] = allParticipants.map((p, i) => ({
    id: String(i),
    name: p.name || p.email || `Participant ${i + 1}`,
  }));

  return {
    id: meeting.id,
    title: meeting.name || meeting.title || 'Sem título',
    createdAt: meeting.happenedAt || meeting.created_at || meeting.createdAt || '',
    updatedAt: meeting.updated_at || meeting.updatedAt || '',
    meetingUrl: meeting.url || meeting.meeting_url || meeting.meetingUrl || '',
    duration: meeting.duration || 0,
    status: meeting.status || '',
    platform: meeting.platform || '',
    organizer: meeting.organizer || undefined,
    invitees: meeting.invitees || [],
    speakers,
    transcript: rawTranscript.map((t: any) => ({
      speaker: t.speaker || t.speaker_name || '',
      speakerId: t.speaker_id || t.speakerId || '',
      text: t.text || t.content || '',
      startTime: t.start_time || t.startTime || t.start || 0,
      endTime: t.end_time || t.endTime || t.end || 0,
    })),
    highlights: rawHighlights.map((h: any) => ({
      id: h.id || '',
      text: h.text || h.content || h.note || '',
      createdAt: h.created_at || h.createdAt || '',
      speaker: h.speaker || h.speaker_name || '',
      startTime: h.start_time || h.startTime || 0,
      source: h.source || '',
      topic: h.topic ? { title: h.topic.title || '', summary: h.topic.summary || '' } : undefined,
    })),
  };
}

