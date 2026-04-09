import { v4 as uuidv4 } from 'uuid';
import { logActivity } from './activityLogger';

export interface MeetingFilters {
  query?: string;
  topic?: string;
  speaker?: string;
  date_filter?: string;
}

export interface ManualMeetingPayload {
  title: string;
  date: string; // ISO string
  markdownContent: string;
  platform?: string;
  duration_minutes?: number;
  participants?: string[];
}

/**
 * Search meeting memory using structured filters or FTS5 for generic strings.
 */
export function searchMeetingMemory(db: any, query: string | MeetingFilters, limit = 5): any[] {
  const cols = `id, timestamp, provider_used, raw_transcript, summary_json,
    title, meeting_date, duration_seconds, platform, external_id,
    speakers_json, highlights_json, status, meeting_url`;

  if (typeof query === 'string') {
    try {
      return db.prepare(`
        SELECT ${cols.split('\\n').map(c => 'm.' + c.trim().replace(/, /g, ', m.')).join('\\n')}
        FROM MeetingMemory_fts f
        JOIN MeetingMemory m ON m.rowid = f.rowid
        WHERE MeetingMemory_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(query, limit);
    } catch {
      return db.prepare(`
        SELECT ${cols}
        FROM MeetingMemory
        WHERE summary_json LIKE ? OR raw_transcript LIKE ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(`%${query}%`, `%${query}%`, limit);
    }
  }

  let sql = `SELECT ${cols} FROM MeetingMemory`;
  const conditions: string[] = [];
  const params: any[] = [];

  const addTextFilter = (text: string, fields: string[]) => {
    const words = text.split(/\\s+/).filter(w => w.length > 2);
    if (words.length === 0) {
      if (text.trim().length > 0) {
        const fieldConditions = fields.map(f => `${f} LIKE ?`).join(' OR ');
        conditions.push(`(${fieldConditions})`);
        fields.forEach(() => params.push(`%${text.trim()}%`));
      }
      return;
    }
    
    for (const word of words) {
      const fieldConditions = fields.map(f => `${f} LIKE ?`).join(' OR ');
      conditions.push(`(${fieldConditions})`);
      fields.forEach(() => params.push(`%${word}%`));
    }
  };

  if (query.query) {
    addTextFilter(query.query, ['summary_json', 'raw_transcript', 'highlights_json', 'title']);
  }

  if (query.topic) {
    addTextFilter(query.topic, ['summary_json', 'title', 'highlights_json']);
  }

  if (query.speaker) {
    addTextFilter(query.speaker, ['speakers_json']);
  }

  if (query.date_filter) {
    const dateCol = `COALESCE(meeting_date, timestamp)`;
    if (query.date_filter === 'today') {
      conditions.push(`date(${dateCol}) = date('now', 'localtime')`);
    } else if (query.date_filter === 'yesterday') {
      conditions.push(`date(${dateCol}) = date('now', '-1 days', 'localtime')`);
    } else if (query.date_filter === 'this_week') {
      conditions.push(`date(${dateCol}) >= date('now', '-7 days', 'localtime')`);
    } else if (query.date_filter === 'this_month') {
      conditions.push(`strftime('%Y-%m', ${dateCol}) = strftime('%Y-%m', 'now', 'localtime')`);
    } else {
      conditions.push(`date(${dateCol}) = ?`);
      params.push(query.date_filter);
    }
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY datetime(COALESCE(meeting_date, timestamp)) DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

/**
 * List all meetings, ordered by date descending.
 */
export function listMeetings(db: any, limit = 50, offset = 0): any[] {
  return db.prepare(`
    SELECT id, timestamp, provider_used, title, meeting_date, duration_seconds,
      platform, external_id, speakers_json, highlights_json, transcript_json,
      status, meeting_url, summary_json
    FROM MeetingMemory
    ORDER BY COALESCE(meeting_date, timestamp) DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * Get full details of a specific meeting including its raw text.
 */
export function getMeetingDetails(db: any, id: string): any {
  return db.prepare(`
    SELECT id, timestamp, provider_used, raw_transcript, summary_json,
      title, meeting_date, duration_seconds, platform, external_id,
      speakers_json, highlights_json, transcript_json, status, meeting_url
    FROM MeetingMemory WHERE id = ?
  `).get(id);
}

/**
 * Add a manually created meeting record with markdown content.
 */
export function addManualMeeting(db: any, payload: ManualMeetingPayload): string {
  const id = uuidv4();
  const summaryJson = {
    title: payload.title,
    date: payload.date,
    platform: payload.platform || 'manual',
    provider: 'manual',
    summary: 'Anotação manual.',
  };
  
  const speakersJson = JSON.stringify(
    (payload.participants || []).map(p => ({ name: p }))
  );
  
  db.prepare(`
    INSERT INTO MeetingMemory (
      id, provider_used, raw_transcript, summary_json,
      title, meeting_date, duration_seconds, platform, speakers_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'manual',
    payload.markdownContent,
    JSON.stringify(summaryJson),
    payload.title,
    payload.date,
    (payload.duration_minutes || 0) * 60,
    payload.platform || 'manual',
    speakersJson,
    'completed'
  );
  
  return id;
}

/**
 * Delete a meeting by id.
 */
export function deleteMeeting(db: any, meetingId: string): boolean {
  const result = db.prepare('DELETE FROM MeetingMemory WHERE id = ?').run(meetingId);
  return result.changes > 0;
}

/**
 * Get meeting context formatted for Maestro prompts (token-efficient).
 */
export function getMeetingContextForPrompt(db: any, meetingId: string): string | null {
  const m = getMeetingDetails(db, meetingId);
  if (!m) return null;

  const parts: string[] = [];
  parts.push(`## Meeting: ${m.title || 'Untitled'}`);
  parts.push(`Date: ${m.meeting_date || m.timestamp}`);
  if (m.platform) parts.push(`Platform: ${m.platform}`);
  if (m.duration_seconds) parts.push(`Duration: ${Math.round(m.duration_seconds / 60)}min`);

  if (m.speakers_json) {
    try {
      const speakers = JSON.parse(m.speakers_json);
      parts.push(`Speakers: ${speakers.map((s: any) => s.name || s).join(', ')}`);
    } catch { }
  }

  if (m.highlights_json) {
    try {
      const highlights = JSON.parse(m.highlights_json);
      if (highlights.length > 0) {
        parts.push('\\n### Key Highlights');
        highlights.slice(0, 10).forEach((h: any) => {
          parts.push(`- ${h.speaker ? `[${h.speaker}] ` : ''}${h.text}`);
        });
      }
    } catch { }
  }

  // Include summary if available
  if (m.summary_json) {
    try {
      const summary = JSON.parse(m.summary_json);
      if (summary.executive_summary) {
        parts.push(`\\n### Summary\\n${summary.executive_summary}`);
      }
      if (summary.decisions?.length) {
        parts.push('\\n### Decisions');
        summary.decisions.forEach((d: string) => parts.push(`- ${d}`));
      }
      if (summary.action_items?.length) {
        parts.push('\\n### Action Items');
        summary.action_items.forEach((a: any) => parts.push(`- [${a.owner}] ${a.task}${a.deadline ? ` (deadline: ${a.deadline})` : ''}`));
      }
    } catch { }
  }

  // Include truncated transcript (max ~2000 chars to save tokens)
  if (m.raw_transcript) {
    const maxLen = 2000;
    const truncated = m.raw_transcript.length > maxLen
      ? m.raw_transcript.slice(0, maxLen) + '\\n[... transcript truncated ...]'
      : m.raw_transcript;
    parts.push(`\\n### Transcript (excerpt)\\n${truncated}`);
  }

  return parts.join('\\n');
}

export interface MeetingAnalysis {
  provider_used: string;
  raw_transcript: string;
  summary_json: any;
}

/**
 * Save a meeting analysis to the database.
 * Populates both legacy columns and new structured columns.
 */
export function saveMeetingMemory(db: any, analysis: MeetingAnalysis): string {
  const id = crypto.randomUUID();
  const summaryStr = JSON.stringify(analysis.summary_json);

  // Extract structured data from summary_json for the new columns
  const title = analysis.summary_json.title || analysis.summary_json.executive_summary?.slice(0, 100) || 'Local Recording';
  const speakers = analysis.summary_json.speakers || [];
  const speakersJson = JSON.stringify(speakers.map((name: string) => ({ name })));
  const highlightsJson = JSON.stringify(analysis.summary_json.highlights || []);
  const durationSeconds: number | null = analysis.summary_json.duration || null;
  const meetingDate = analysis.summary_json.date || null;
  const platform = analysis.summary_json.platform || 'local';
  const meetingUrl = analysis.summary_json.meeting_url || null;

  db.prepare(`
    INSERT INTO MeetingMemory (id, provider_used, raw_transcript, summary_json,
      title, meeting_date, duration_seconds, platform, speakers_json, highlights_json, meeting_url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
  `).run(
    id, analysis.provider_used, analysis.raw_transcript, summaryStr,
    title, meetingDate || new Date().toISOString(), durationSeconds, platform, speakersJson, highlightsJson, meetingUrl
  );
  console.log(`[MeetingService] Meeting saved: ${id}`);
  logActivity('meetings', `Reunião salva: ${title} (${durationSeconds ? Math.round(durationSeconds / 60) + 'm' : 'duração desconhecida'}) — provider: ${analysis.provider_used}`, { meetingId: id }, true);
  return id;
}
