/**
 * communicationsStore — persistence layer for RawCommunications.
 *
 * Spec 11 §3.2. Upsert-by-graphId (dedup), listing with filters, and a
 * 14-day TTL sweeper invoked from the scheduler.
 */

import { v4 as uuidv4 } from 'uuid';

export type CommSource = 'outlook' | 'teams';

export interface CommunicationItem {
  id: string;
  graphId: string;
  source: CommSource;
  sender: string;
  senderEmail?: string;
  subject?: string;
  channelOrChatName?: string;
  plainText: string;
  timestamp: string;
  isUnread: boolean;
  webLink?: string;
  importance?: 'low' | 'normal' | 'high';
  mentionsMe?: boolean;
  /** Outlook conversationId — used to group email thread. */
  threadId?: string;
  /** Teams chatId — used to group messages from the same chat/group. */
  groupId?: string;
}

export interface ListFilter {
  since?: string;
  until?: string;
  limit?: number;
  sources?: CommSource[];
  ids?: string[];
}

/** Upsert one item by `graph_id`. Returns true when a new row was inserted. */
export function upsertCommunication(db: any, item: Omit<CommunicationItem, 'id'> & { id?: string }): boolean {
  const existing = db.prepare('SELECT id FROM RawCommunications WHERE graph_id = ?').get(item.graphId) as any;
  const id = existing?.id || item.id || uuidv4();
  const stmt = db.prepare(`
    INSERT INTO RawCommunications (
      id, graph_id, source, sender, sender_email, subject, channel_name,
      plain_text, timestamp, is_unread, web_link, importance, mentions_me,
      thread_id, group_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(graph_id) DO UPDATE SET
      sender        = excluded.sender,
      sender_email  = excluded.sender_email,
      subject       = excluded.subject,
      channel_name  = excluded.channel_name,
      plain_text    = excluded.plain_text,
      timestamp     = excluded.timestamp,
      is_unread     = excluded.is_unread,
      web_link      = excluded.web_link,
      importance    = excluded.importance,
      mentions_me   = excluded.mentions_me,
      thread_id     = excluded.thread_id,
      group_id      = excluded.group_id
  `);
  stmt.run(
    id,
    item.graphId,
    item.source,
    item.sender,
    item.senderEmail || null,
    item.subject || null,
    item.channelOrChatName || null,
    item.plainText,
    item.timestamp,
    item.isUnread ? 1 : 0,
    item.webLink || null,
    item.importance || null,
    item.mentionsMe ? 1 : 0,
    item.threadId || null,
    item.groupId || null,
  );
  return !existing;
}

/** Bulk upsert. Returns the number of newly inserted items. */
export function upsertMany(db: any, items: Array<Omit<CommunicationItem, 'id'>>): number {
  let inserted = 0;
  const tx = db.transaction((batch: any[]) => {
    for (const it of batch) { if (upsertCommunication(db, it)) inserted++; }
  });
  tx(items);
  return inserted;
}

function rowToItem(r: any): CommunicationItem {
  return {
    id: r.id,
    graphId: r.graph_id,
    source: r.source,
    sender: r.sender,
    senderEmail: r.sender_email || undefined,
    subject: r.subject || undefined,
    channelOrChatName: r.channel_name || undefined,
    plainText: r.plain_text,
    timestamp: r.timestamp,
    isUnread: !!r.is_unread,
    webLink: r.web_link || undefined,
    importance: (r.importance as any) || undefined,
    mentionsMe: !!r.mentions_me,
    threadId: r.thread_id || undefined,
    groupId: r.group_id || undefined,
  };
}

export function listCommunications(db: any, filter: ListFilter = {}): CommunicationItem[] {
  const limit = Math.min(Math.max(filter.limit ?? 500, 1), 5000);
  const where: string[] = [];
  const params: any[] = [];
  if (filter.since) { where.push('timestamp >= ?'); params.push(filter.since); }
  if (filter.until) { where.push('timestamp < ?'); params.push(filter.until); }
  if (filter.sources && filter.sources.length > 0) {
    where.push(`source IN (${filter.sources.map(() => '?').join(',')})`);
    params.push(...filter.sources);
  }
  if (filter.ids && filter.ids.length > 0) {
    where.push(`id IN (${filter.ids.map(() => '?').join(',')})`);
    params.push(...filter.ids);
  }
  const sql = `SELECT * FROM RawCommunications ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY timestamp DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(rowToItem);
}

export function getCommunicationsByIds(db: any, ids: string[]): CommunicationItem[] {
  if (ids.length === 0) return [];
  const sql = `SELECT * FROM RawCommunications WHERE id IN (${ids.map(() => '?').join(',')})`;
  return (db.prepare(sql).all(...ids) as any[]).map(rowToItem);
}

/** Return the most-recent `timestamp` we already ingested for a given source. */
export function getLastTimestamp(db: any, source: CommSource): string | null {
  const row = db.prepare('SELECT timestamp FROM RawCommunications WHERE source = ? ORDER BY timestamp DESC LIMIT 1').get(source) as any;
  return row?.timestamp || null;
}

/** Sweep rows older than `days` days. Returns the number of rows removed. */
export function sweepOld(db: any, days = 14): number {
  try {
    const r = db.prepare(`DELETE FROM RawCommunications WHERE timestamp < datetime('now', ?)`).run(`-${days} days`);
    return r.changes;
  } catch { return 0; }
}

export function clearAll(db: any): void {
  try { db.prepare('DELETE FROM RawCommunications').run(); } catch { }
}

