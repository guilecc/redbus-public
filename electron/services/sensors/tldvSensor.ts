/**
 * tldvSensor — Polling-based sync engine for tl;dv meetings.
 *
 * Periodically fetches new meetings from tl;dv API and saves them
 * to MeetingMemory in SQLite. Supports force-sync (manual trigger).
 *
 * Architecture:
 *   - Background timer polls every POLL_INTERVAL_MS (default 5 min)
 *   - `forceSyncNow()` triggers an immediate sync cycle
 *   - Each cycle calls `runTldvSyncCycle()` which:
 *     1. Reads the API key from AppSettings
 *     2. Fetches meetings since last sync
 *     3. For each new meeting, fetches details (transcript + highlights)
 *     4. Saves to MeetingMemory with provider_used = 'tldv'
 *     5. Updates last sync timestamp
 */

import { v4 as uuidv4 } from 'uuid';
import { fetchRecentMeetings, fetchMeetingDetails, type TldvMeetingDetails } from '../tldvService';
import { logActivity } from '../activityLogger';

// ── Configuration ──
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SETTINGS_KEY_API_KEY = 'tldv_api_key';
const SETTINGS_KEY_LAST_SYNC = 'tldv_last_sync_at';

// ── State ──
let _db: any = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _syncing = false;
let _lastSyncResult: SyncResult | null = null;

export interface SyncResult {
  success: boolean;
  syncedAt: string;
  newMeetings: number;
  error?: string;
}

/* ── Helpers ── */

function getApiKey(): string | null {
  if (!_db) return null;
  try {
    const row = _db.prepare('SELECT value FROM AppSettings WHERE key = ?').get(SETTINGS_KEY_API_KEY);
    return row?.value || null;
  } catch { return null; }
}

function getLastSyncAt(): string | null {
  if (!_db) return null;
  try {
    const row = _db.prepare('SELECT value FROM AppSettings WHERE key = ?').get(SETTINGS_KEY_LAST_SYNC);
    return row?.value || null;
  } catch { return null; }
}

function setLastSyncAt(iso: string): void {
  if (!_db) return;
  try {
    _db.prepare('INSERT OR REPLACE INTO AppSettings (key, value, updatedAt) VALUES (?, ?, datetime(\'now\'))').run(SETTINGS_KEY_LAST_SYNC, iso);
  } catch { /* non-fatal */ }
}

function isMeetingAlreadySaved(tldvId: string): boolean {
  if (!_db) return false;
  try {
    // Use indexed external_id column first, fallback to legacy LIKE
    const row = _db.prepare(
      "SELECT id FROM MeetingMemory WHERE external_id = ? AND provider_used = 'tldv'"
    ).get(tldvId);
    if (row) return true;
    // Legacy fallback for pre-migration data
    const legacy = _db.prepare(
      "SELECT id FROM MeetingMemory WHERE summary_json LIKE ? AND provider_used = 'tldv'"
    ).get(`%"tldv_id":"${tldvId}"%`);
    return !!legacy;
  } catch { return false; }
}

function saveTldvMeeting(details: TldvMeetingDetails): string {
  const id = uuidv4();
  const transcriptText = details.transcript
    .map(t => `[${t.speaker}] ${t.text}`)
    .join('\n');

  const speakers = details.speakers.map(s => ({ name: s.name, id: s.id }));
  const highlights = details.highlights.map(h => ({
    id: h.id,
    text: h.text,
    speaker: h.speaker || null,
    startTime: h.startTime || null,
    createdAt: h.createdAt || null,
    source: h.source || null,
    topic: h.topic ? { title: h.topic.title, summary: h.topic.summary } : null,
  }));

  // Structured transcript entries with speaker + timestamps
  const transcriptEntries = details.transcript.map(t => ({
    speaker: t.speaker,
    speakerId: t.speakerId || null,
    text: t.text,
    startTime: t.startTime || 0,
    endTime: t.endTime || 0,
  }));

  const summaryJson = {
    tldv_id: details.id,
    title: details.title,
    date: details.createdAt,
    platform: details.platform,
    duration: details.duration,
    speakers: speakers.map(s => s.name),
    highlights: highlights.map(h => ({ text: h.text, speaker: h.speaker })),
    meeting_url: details.meetingUrl,
  };

  _db.prepare(`
    INSERT INTO MeetingMemory (id, provider_used, raw_transcript, summary_json,
      title, meeting_date, duration_seconds, platform, external_id,
      speakers_json, highlights_json, transcript_json, status, meeting_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, 'tldv', transcriptText, JSON.stringify(summaryJson),
    details.title,
    details.createdAt || null,
    details.duration || null,
    details.platform || null,
    details.id,
    JSON.stringify(speakers),
    JSON.stringify(highlights),
    JSON.stringify(transcriptEntries),
    details.status || 'completed',
    details.meetingUrl || null,
  );

  return id;
}

/* ── Core sync cycle ── */

export async function runTldvSyncCycle(): Promise<SyncResult> {
  if (_syncing) return { success: false, syncedAt: new Date().toISOString(), newMeetings: 0, error: 'Sync already in progress' };
  _syncing = true;

  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      _syncing = false;
      return { success: false, syncedAt: new Date().toISOString(), newMeetings: 0, error: 'API key not configured' };
    }

    const lastSync = getLastSyncAt();
    const meetings = await fetchRecentMeetings(apiKey, {
      limit: 20,
      from: lastSync || undefined,
    });

    let newCount = 0;
    for (const meeting of meetings) {
      if (isMeetingAlreadySaved(meeting.id)) continue;

      try {
        const details = await fetchMeetingDetails(apiKey, meeting.id);
        saveTldvMeeting(details);
        newCount++;
        console.log(`[tldvSensor] Saved meeting: ${details.title} (${details.id})`);
      } catch (e) {
        console.error(`[tldvSensor] Failed to fetch details for ${meeting.id}:`, e);
      }
    }

    const now = new Date().toISOString();
    setLastSyncAt(now);
    _lastSyncResult = { success: true, syncedAt: now, newMeetings: newCount };
    _syncing = false;
    console.log(`[tldvSensor] Sync complete: ${newCount} new meetings`);
    logActivity('sensors', `tl;dv: sincronização concluída — ${newCount} reuniões novas`);
    return _lastSyncResult;
  } catch (e: any) {
    _syncing = false;
    _lastSyncResult = { success: false, syncedAt: new Date().toISOString(), newMeetings: 0, error: e.message };
    console.error('[tldvSensor] Sync failed:', e);
    return _lastSyncResult;
  }
}



/* ── Public API ── */

export function initTldvSensor(db: any): void {
  _db = db;
}

export function startTldvPolling(): void {
  if (_pollTimer) return;
  console.log(`[tldvSensor] Background polling started (every ${POLL_INTERVAL_MS / 1000}s)`);
  runTldvSyncCycle().catch(e => console.error('[tldvSensor] Initial sync error:', e));
  _pollTimer = setInterval(() => {
    runTldvSyncCycle().catch(e => console.error('[tldvSensor] Polling sync error:', e));
  }, POLL_INTERVAL_MS);
}

export function stopTldvPolling(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
    console.log('[tldvSensor] Background polling stopped');
  }
}

export async function forceSyncNow(): Promise<SyncResult> {
  return runTldvSyncCycle();
}

export function getTldvSyncStatus(): {
  enabled: boolean;
  syncing: boolean;
  lastResult: SyncResult | null;
  hasApiKey: boolean;
} {
  return {
    enabled: _pollTimer !== null,
    syncing: _syncing,
    lastResult: _lastSyncResult,
    hasApiKey: !!getApiKey(),
  };
}