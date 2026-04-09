import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  type?: string;
  specData?: string; // JSON-serialized
  compacted?: number; // 0 = active, 1 = compacted into summary
  createdAt: string;
}

export interface ArchiveFile {
  filename: string;
  filepath: string;
  sizeBytes: number;
  label: string; // Human-readable, e.g. "2026-03-01"
}

/**
 * Ensures the ChatMessages table exists in the given db
 */
export function ensureMessagesTable(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ChatMessages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      type TEXT,
      specData TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Save a message to the primary database
 */
export function saveMessage(db: any, msg: Omit<ChatMessage, 'createdAt'>) {
  ensureMessagesTable(db);
  db.prepare(`
    INSERT OR REPLACE INTO ChatMessages (id, role, content, type, specData, createdAt)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(msg.id, msg.role, msg.content, msg.type || null, msg.specData || null);
}

/**
 * Get messages from the primary database with pagination
 */
export function getMessages(db: any, limit: number, offset: number): ChatMessage[] {
  ensureMessagesTable(db);
  return db.prepare(
    `SELECT * FROM ChatMessages WHERE (type IS NULL OR type != 'thinking') ORDER BY createdAt ASC LIMIT ? OFFSET ?`
  ).all(limit, offset) as ChatMessage[];
}

/**
 * Count total messages in the primary database (excludes internal thinking messages)
 */
export function countMessages(db: any): number {
  ensureMessagesTable(db);
  const row = db.prepare(`SELECT COUNT(*) as count FROM ChatMessages WHERE (type IS NULL OR type != 'thinking')`).get() as any;
  return row.count;
}

/**
 * Get uncompacted messages (compacted = 0) ordered by creation time.
 * Excludes internal thinking messages.
 */
export function getUncompactedMessages(db: any, limit?: number): ChatMessage[] {
  const sql = limit
    ? `SELECT * FROM ChatMessages WHERE compacted = 0 AND (type IS NULL OR type != 'thinking') ORDER BY createdAt ASC LIMIT ?`
    : `SELECT * FROM ChatMessages WHERE compacted = 0 AND (type IS NULL OR type != 'thinking') ORDER BY createdAt ASC`;
  return limit ? db.prepare(sql).all(limit) as ChatMessage[] : db.prepare(sql).all() as ChatMessage[];
}

/**
 * Count uncompacted messages (excludes internal thinking messages)
 */
export function countUncompactedMessages(db: any): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ChatMessages WHERE compacted = 0 AND (type IS NULL OR type != 'thinking')`).get() as any;
  return row.count;
}

/**
 * Mark messages as compacted by their IDs
 */
export function markMessagesAsCompacted(db: any, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE ChatMessages SET compacted = 1 WHERE id IN (${placeholders})`).run(...ids);
}

/**
 * Get the current conversation summary
 */
export function getConversationSummary(db: any): string {
  try {
    const row = db.prepare('SELECT summary FROM ConversationSummary WHERE id = 1').get() as any;
    return row?.summary || '';
  } catch {
    return '';
  }
}

/**
 * Update the conversation summary
 */
export function updateConversationSummary(db: any, summary: string): void {
  db.prepare(`
    UPDATE ConversationSummary
    SET summary = ?, lastCompactedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(summary);
}

/**
 * Archive messages older than `daysOld` days (or if count > maxRows).
 * Moves them to an archive sqlite file in the `archives/` subfolder.
 * Returns the path of the created archive (or null if nothing was archived).
 */
export function archiveOldMessages(
  db: any,
  userDataPath: string,
  daysOld: number = 7,
  maxRows: number = 500
): string | null {
  ensureMessagesTable(db);

  const total = countMessages(db);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  const cutoffISO = cutoffDate.toISOString().split('T')[0];

  // Decide whether to archive based on count or age
  let rowsToArchive: ChatMessage[];
  if (total > maxRows) {
    // Archive oldest messages beyond maxRows
    const keepRows = Math.floor(maxRows * 0.7); // keep 70%
    rowsToArchive = db.prepare(
      `SELECT * FROM ChatMessages ORDER BY createdAt ASC LIMIT ?`
    ).all(total - keepRows) as ChatMessage[];
  } else {
    // Archive by age
    rowsToArchive = db.prepare(
      `SELECT * FROM ChatMessages WHERE date(createdAt) < ? ORDER BY createdAt ASC`
    ).all(cutoffISO) as ChatMessage[];
  }

  if (rowsToArchive.length === 0) return null;

  // Pick archive date from first row
  const archiveDateStr = rowsToArchive[0].createdAt.split('T')[0].replace(/-/g, '');
  const archivesDir = path.join(userDataPath, 'archives');
  if (!fs.existsSync(archivesDir)) fs.mkdirSync(archivesDir, { recursive: true });

  const archiveFilename = `.redbus_archive_${archiveDateStr}.sqlite`;
  const archivePath = path.join(archivesDir, archiveFilename);

  const archiveDb = new Database(archivePath);
  archiveDb.pragma('journal_mode = WAL');
  ensureMessagesTable(archiveDb);

  // Insert into archive in a transaction
  const insertStmt = archiveDb.prepare(`
    INSERT OR IGNORE INTO ChatMessages (id, role, content, type, specData, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = archiveDb.transaction((rows: ChatMessage[]) => {
    for (const row of rows) {
      insertStmt.run(row.id, row.role, row.content, row.type || null, row.specData || null, row.createdAt);
    }
  });
  insertMany(rowsToArchive);
  archiveDb.close();

  // Delete archived rows from primary db
  const ids = rowsToArchive.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM ChatMessages WHERE id IN (${placeholders})`).run(...ids);

  return archivePath;
}

/**
 * List all archive files in the archives/ folder
 */
export function listArchiveFiles(userDataPath: string): ArchiveFile[] {
  const archivesDir = path.join(userDataPath, 'archives');
  if (!fs.existsSync(archivesDir)) return [];

  const files = fs.readdirSync(archivesDir).filter(f => f.endsWith('.sqlite'));
  return files.map(f => {
    const filepath = path.join(archivesDir, f);
    const stat = fs.statSync(filepath);
    const dateMatch = f.match(/(\d{4})(\d{2})(\d{2})/);
    const label = dateMatch
      ? `Arquivo de ${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
      : f;
    return { filename: f, filepath, sizeBytes: stat.size, label };
  }).sort((a, b) => b.filename.localeCompare(a.filename));
}

/**
 * Delete a single archive file by filename
 */
export function deleteArchiveFile(userDataPath: string, filename: string): boolean {
  const archivesDir = path.join(userDataPath, 'archives');
  const filepath = path.join(archivesDir, filename);
  if (!fs.existsSync(filepath)) return false;
  fs.unlinkSync(filepath);
  return true;
}

/**
 * Retrieve messages from an archive file with pagination
 */
export function getMessagesFromArchive(archivePath: string, limit: number, offset: number): ChatMessage[] {
  if (!fs.existsSync(archivePath)) return [];
  const archiveDb = new Database(archivePath, { readonly: true });
  const rows = archiveDb.prepare(
    `SELECT * FROM ChatMessages WHERE (type IS NULL OR type != 'thinking') ORDER BY createdAt ASC LIMIT ? OFFSET ?`
  ).all(limit, offset) as ChatMessage[];
  archiveDb.close();
  return rows;
}
