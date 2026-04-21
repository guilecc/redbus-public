/**
 * graphMailService — fetch recent Outlook messages via Microsoft Graph.
 *
 * Spec 11 §9. Uses `/me/messages` with `receivedDateTime` filter. Body is
 * requested as HTML and stripped to plain text before persistence.
 */

import { graphFetchPaged } from './graphClient';
import { stripToPlainText } from './textSanitizer';
import type { CommunicationItem } from '../communicationsStore';
import { upsertMany, getLastTimestamp } from '../communicationsStore';
import { getAppSetting, setAppSetting } from '../../database';
import { logActivity } from '../activityLogger';

const SK_LAST_POLL = 'graph.last_poll_mail';

export interface FetchMailOptions {
  top?: number;
  since?: string;
  pageCap?: number;
}

interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: 'html' | 'text'; content?: string };
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  isRead?: boolean;
  importance?: 'low' | 'normal' | 'high';
  webLink?: string;
  conversationId?: string;
}

function graphMsgToItem(m: GraphMessage): Omit<CommunicationItem, 'id'> {
  const name = m.from?.emailAddress?.name || m.from?.emailAddress?.address || '(desconhecido)';
  const email = m.from?.emailAddress?.address;
  const senderLabel = email ? `${name} <${email}>` : name;
  const html = m.body?.content || m.bodyPreview || '';
  const plainInput = (m.body?.contentType || 'html') === 'text';
  const plainText = stripToPlainText(html, { plainInput });
  return {
    graphId: m.id,
    source: 'outlook',
    sender: senderLabel,
    senderEmail: email,
    subject: m.subject || '(sem assunto)',
    plainText,
    timestamp: m.receivedDateTime || new Date().toISOString(),
    isUnread: m.isRead === false,
    webLink: m.webLink,
    importance: m.importance,
    mentionsMe: false,
    threadId: m.conversationId,
  };
}

/** One poll cycle. Returns the items ingested (already persisted). */
export async function fetchRecentMessages(db: any, opts: FetchMailOptions = {}): Promise<number> {
  const top = Math.min(Math.max(opts.top ?? 50, 1), 100);
  const since = opts.since || getAppSetting(db, SK_LAST_POLL) || _defaultSince(db);
  const pageCap = opts.pageCap ?? 5;

  // Graph $filter + $orderby + $select + $top. Grabs the server-side HTML body.
  const query: Record<string, string> = {
    '$top': String(top),
    '$orderby': 'receivedDateTime desc',
    '$filter': `receivedDateTime ge ${since}`,
    '$select': 'id,subject,bodyPreview,body,from,receivedDateTime,isRead,importance,webLink,conversationId',
  };

  let messages: GraphMessage[] = [];
  try {
    messages = await graphFetchPaged<GraphMessage>(db, '/me/messages', { query, pageCap });
  } catch (e: any) {
    logActivity('inbox', `Graph mail: falha no poll (${e?.name || 'erro'})`, { error: String(e?.message || e) });
    throw e;
  }

  if (messages.length === 0) {
    setAppSetting(db, SK_LAST_POLL, new Date().toISOString());
    return 0;
  }

  const items = messages.map(graphMsgToItem);
  const inserted = upsertMany(db, items);
  setAppSetting(db, SK_LAST_POLL, new Date().toISOString());
  if (inserted > 0) {
    logActivity('inbox', `Graph mail: ingeridos ${inserted} novos (${messages.length} vistos)`);
  }
  return inserted;
}

/** When no `lastPollAt` is set yet, first poll looks back 72h (spec §9). */
function _defaultSince(db: any): string {
  const last = getLastTimestamp(db, 'outlook');
  if (last) return last;
  const d = new Date(Date.now() - 72 * 3600 * 1000);
  return d.toISOString();
}

/**
 * Backfill Graph /me/messages within an arbitrary [since, until) ISO range.
 * Used when the user navigates to an older date in the Hub calendar. Does not
 * touch the live-poll bookmark (`SK_LAST_POLL`).
 */
export async function fetchMessagesInRange(
  db: any,
  since: string,
  until: string,
  opts: { top?: number; pageCap?: number } = {},
): Promise<number> {
  const top = Math.min(Math.max(opts.top ?? 50, 1), 100);
  const pageCap = opts.pageCap ?? 10;

  const query: Record<string, string> = {
    '$top': String(top),
    '$orderby': 'receivedDateTime desc',
    '$filter': `receivedDateTime ge ${since} and receivedDateTime lt ${until}`,
    '$select': 'id,subject,bodyPreview,body,from,receivedDateTime,isRead,importance,webLink,conversationId',
  };

  let messages: GraphMessage[] = [];
  try {
    messages = await graphFetchPaged<GraphMessage>(db, '/me/messages', { query, pageCap });
  } catch (e: any) {
    logActivity('inbox', `Graph mail: falha no backfill (${e?.name || 'erro'})`, { error: String(e?.message || e), since, until });
    throw e;
  }

  if (messages.length === 0) return 0;
  const items = messages.map(graphMsgToItem);
  const inserted = upsertMany(db, items);
  logActivity('inbox', `Graph mail: backfill ${since.slice(0, 10)} → ${inserted} novos (${messages.length} vistos)`);
  return inserted;
}

