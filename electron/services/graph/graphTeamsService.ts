/**
 * graphTeamsService — fetch recent Teams chat messages via Microsoft Graph.
 *
 * Spec 11 §9. Two-step walk: list `/me/chats`, then for each chat pull
 * `/chats/{id}/messages` filtered by `lastModifiedDateTime`. Mentions of the
 * authenticated user are flagged via `mentions[].mentioned.user.id === me.id`.
 */

import { graphFetch, graphFetchPaged } from './graphClient';
import { stripToPlainText } from './textSanitizer';
import { getMeId } from './graphAuthService';
import type { CommunicationItem } from '../communicationsStore';
import { upsertMany, getLastTimestamp } from '../communicationsStore';
import { getAppSetting, setAppSetting } from '../../database';
import { logActivity } from '../activityLogger';

const SK_LAST_POLL = 'graph.last_poll_teams';

interface GraphChat {
  id: string;
  topic?: string | null;
  chatType?: 'oneOnOne' | 'group' | 'meeting' | string;
  lastMessagePreview?: { createdDateTime?: string };
}

interface GraphChatMessage {
  id: string;
  chatId?: string;
  messageType?: string; // 'message' | 'systemEventMessage' | ...
  body?: { contentType?: 'html' | 'text'; content?: string };
  from?: { user?: { id?: string; displayName?: string } };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  webUrl?: string;
  importance?: 'normal' | 'high' | 'urgent';
  mentions?: Array<{ mentioned?: { user?: { id?: string } } }>;
}

export interface FetchTeamsOptions {
  since?: string;
  chatsCap?: number;
  perChatPageCap?: number;
}

function msgToItem(chat: GraphChat, m: GraphChatMessage, meId: string | null): Omit<CommunicationItem, 'id'> | null {
  if (m.messageType && m.messageType !== 'message') return null;
  const sender = m.from?.user?.displayName || '(Teams)';
  const html = m.body?.content || '';
  const plainInput = (m.body?.contentType || 'html') === 'text';
  const plainText = stripToPlainText(html, { plainInput });
  if (!plainText) return null;
  const mentionsMe = !!(meId && (m.mentions || []).some(x => x?.mentioned?.user?.id === meId));
  // Outlook `importance` enum differs from Teams — collapse `urgent` → `high`.
  const imp = m.importance === 'urgent' ? 'high' : (m.importance === 'high' ? 'high' : 'normal');
  const chatLabel = chat.topic || (chat.chatType === 'oneOnOne' ? sender : 'Teams');
  return {
    graphId: m.id,
    source: 'teams',
    sender: `${sender} (Teams)`,
    channelOrChatName: chatLabel,
    plainText,
    timestamp: m.createdDateTime || m.lastModifiedDateTime || new Date().toISOString(),
    isUnread: true,
    webLink: m.webUrl,
    importance: imp,
    mentionsMe,
    groupId: chat.id,
  };
}

export async function fetchRecentChatMessages(db: any, opts: FetchTeamsOptions = {}): Promise<number> {
  const since = opts.since || getAppSetting(db, SK_LAST_POLL) || _defaultSince(db);
  const chatsCap = opts.chatsCap ?? 10;
  const perChatPageCap = opts.perChatPageCap ?? 3;
  const meId = getMeId(db);

  // 1) List chats ordered by last activity — newest first
  let chats: GraphChat[] = [];
  try {
    chats = await graphFetchPaged<GraphChat>(db, '/me/chats', {
      query: { '$orderby': 'lastMessagePreview/createdDateTime desc', '$top': '20' },
      pageCap: 2,
    });
  } catch (e: any) {
    logActivity('inbox', `Graph teams: falha ao listar chats`, { error: String(e?.message || e) });
    throw e;
  }

  const items: Array<Omit<CommunicationItem, 'id'>> = [];
  let walked = 0;
  for (const chat of chats) {
    if (walked >= chatsCap) break;
    // Skip chats whose most-recent message is older than `since`
    const lastPreview = chat.lastMessagePreview?.createdDateTime;
    if (lastPreview && lastPreview < since) continue;
    walked++;
    try {
      const msgs = await graphFetchPaged<GraphChatMessage>(db, `/chats/${chat.id}/messages`, {
        query: { '$top': '50', '$orderby': 'lastModifiedDateTime desc' },
        pageCap: perChatPageCap,
        stop: (m) => {
          const ts = m.createdDateTime || m.lastModifiedDateTime;
          return !!ts && ts < since;
        },
      });
      for (const m of msgs) {
        const item = msgToItem(chat, m, meId);
        if (item && item.timestamp >= since) items.push(item);
      }
    } catch (e: any) {
      logActivity('inbox', `Graph teams: falha em chat ${chat.id}`, { error: String(e?.message || e) });
    }
  }

  const inserted = upsertMany(db, items);
  setAppSetting(db, SK_LAST_POLL, new Date().toISOString());
  if (inserted > 0) {
    logActivity('inbox', `Graph teams: ingeridos ${inserted} novos (${items.length} vistos em ${walked} chats)`);
  }
  return inserted;
}

function _defaultSince(db: any): string {
  const last = getLastTimestamp(db, 'teams');
  if (last) return last;
  const d = new Date(Date.now() - 72 * 3600 * 1000);
  return d.toISOString();
}

/**
 * Backfill Teams chat messages within [since, until). Walks up to `chatsCap`
 * chats (all chats, not only those active in the window — chats may have old
 * messages even when `lastMessagePreview` is recent). Does not touch the
 * live-poll bookmark.
 */
export async function fetchChatMessagesInRange(
  db: any,
  since: string,
  until: string,
  opts: { chatsCap?: number; perChatPageCap?: number } = {},
): Promise<number> {
  const chatsCap = opts.chatsCap ?? 30;
  const perChatPageCap = opts.perChatPageCap ?? 6;
  const meId = getMeId(db);

  let chats: GraphChat[] = [];
  try {
    chats = await graphFetchPaged<GraphChat>(db, '/me/chats', {
      query: { '$orderby': 'lastMessagePreview/createdDateTime desc', '$top': '20' },
      pageCap: 3,
    });
  } catch (e: any) {
    logActivity('inbox', `Graph teams: falha ao listar chats (backfill)`, { error: String(e?.message || e), since, until });
    throw e;
  }

  const items: Array<Omit<CommunicationItem, 'id'>> = [];
  let walked = 0;
  for (const chat of chats) {
    if (walked >= chatsCap) break;
    // Skip chats whose most-recent activity is before our range starts.
    const lastPreview = chat.lastMessagePreview?.createdDateTime;
    if (lastPreview && lastPreview < since) continue;
    walked++;
    try {
      const msgs = await graphFetchPaged<GraphChatMessage>(db, `/chats/${chat.id}/messages`, {
        query: { '$top': '50', '$orderby': 'lastModifiedDateTime desc' },
        pageCap: perChatPageCap,
        // Stop walking pages once we're entirely below `since`.
        stop: (m) => {
          const ts = m.createdDateTime || m.lastModifiedDateTime;
          return !!ts && ts < since;
        },
      });
      for (const m of msgs) {
        const item = msgToItem(chat, m, meId);
        if (item && item.timestamp >= since && item.timestamp < until) items.push(item);
      }
    } catch (e: any) {
      logActivity('inbox', `Graph teams: falha no chat ${chat.id} (backfill)`, { error: String(e?.message || e) });
    }
  }

  const inserted = upsertMany(db, items);
  if (inserted > 0) {
    logActivity('inbox', `Graph teams: backfill ${since.slice(0, 10)} → ${inserted} novos (${items.length} vistos em ${walked} chats)`);
  }
  return inserted;
}

