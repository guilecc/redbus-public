/**
 * ScreenMemoryService — CRUD + FTS5 search for OCR screen captures.
 *
 * Stores extracted text from screen captures in SQLite with full-text search.
 * Auto-prunes records older than 7 days to conserve disk space.
 */

import { createHash } from 'crypto';

const MAX_AGE_DAYS = 7;

/**
 * Save an OCR result to ScreenMemory.
 * Deduplicates by text_hash — if the exact same text was already captured, skip.
 * Returns true if saved, false if duplicate.
 */
export function saveScreenCapture(
  db: any,
  extractedText: string,
  activeApp?: string,
  activeTitle?: string
): boolean {
  if (!extractedText || extractedText.trim().length < 20) return false;

  const textHash = createHash('md5').update(extractedText).digest('hex');

  // Check for recent duplicate (same hash in last 60 seconds)
  const recent = db.prepare(
    `SELECT id FROM ScreenMemory WHERE text_hash = ? AND timestamp > datetime('now', '-60 seconds')`
  ).get(textHash);

  if (recent) return false; // Duplicate — skip

  db.prepare(
    `INSERT INTO ScreenMemory (active_app, active_title, extracted_text, text_hash)
     VALUES (?, ?, ?, ?)`
  ).run(activeApp || null, activeTitle || null, extractedText, textHash);

  return true;
}

/**
 * Search screen memory using FTS5 full-text search.
 * Returns matches ordered by relevance (rank).
 */
export function searchScreenMemory(
  db: any,
  query: string,
  limit = 5
): Array<{ id: number; timestamp: string; activeApp: string; activeTitle: string; snippet: string }> {
  if (!query || query.trim().length === 0) return [];

  // Sanitize query for FTS5 — escape special chars, add prefix matching
  const sanitized = query
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .map(w => `"${w}"`)
    .join(' OR ');

  if (!sanitized) return [];

  try {
    const rows = db.prepare(`
      SELECT sm.id, sm.timestamp, sm.active_app, sm.active_title,
             snippet(ScreenMemory_fts, 0, '>>>', '<<<', '...', 40) as snippet
      FROM ScreenMemory_fts
      JOIN ScreenMemory sm ON sm.id = ScreenMemory_fts.rowid
      WHERE ScreenMemory_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(sanitized, limit);

    return rows.map((r: any) => ({
      id: r.id,
      timestamp: r.timestamp,
      activeApp: r.active_app || '',
      activeTitle: r.active_title || '',
      snippet: r.snippet || '',
    }));
  } catch (e) {
    console.error('[ScreenMemory] FTS5 search failed:', e);
    return [];
  }
}

/**
 * Prune screen memory records older than MAX_AGE_DAYS.
 */
export function pruneOldScreenMemory(db: any): number {
  const result = db.prepare(
    `DELETE FROM ScreenMemory WHERE timestamp < datetime('now', '-${MAX_AGE_DAYS} days')`
  ).run();
  return result.changes;
}

/**
 * Count total screen memory records.
 */
export function countScreenMemoryRecords(db: any): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM ScreenMemory').get();
  return row?.count ?? 0;
}

