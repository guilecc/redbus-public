import type { CommunicationItem } from '../../types/ipc';

export interface MessageGroup {
  /** Stable id used for react keys + selection-all/blacklist operations. */
  key: string;
  /** Display label (subject for email, chat name for teams). */
  label: string;
  /** Blacklist token suggestion (used by "blacklist group" action). */
  blacklistToken: string;
  /** Items sorted timestamp DESC. */
  items: CommunicationItem[];
  /** Most-recent timestamp. Used to sort groups DESC. */
  latest: string;
  /** True when any item in group is unread. */
  hasUnread: boolean;
  /** True when any item mentions the user. */
  hasMention: boolean;
}

function normSubject(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/^\s*(re|fw|fwd|res|enc)\s*:\s*/i, '').trim().toLowerCase();
}

/**
 * Group messages for display.
 * - outlook → threadId || normalized subject || graphId (single-row group).
 * - teams   → groupId || channelOrChatName || graphId.
 */
export function groupMessages(items: CommunicationItem[]): MessageGroup[] {
  const map = new Map<string, MessageGroup>();
  for (const it of items) {
    let key: string;
    let label: string;
    let token: string;
    if (it.source === 'outlook') {
      const norm = normSubject(it.subject);
      key = it.threadId ? `t:${it.threadId}` : (norm ? `s:${norm}` : `i:${it.id}`);
      label = it.subject || '(sem assunto)';
      token = norm || (it.subject || '').toLowerCase();
    } else {
      key = it.groupId ? `g:${it.groupId}` : (it.channelOrChatName ? `c:${it.channelOrChatName.toLowerCase()}` : `i:${it.id}`);
      label = it.channelOrChatName || it.sender || 'Teams';
      token = (it.channelOrChatName || '').toLowerCase();
    }
    const existing = map.get(key);
    if (existing) {
      existing.items.push(it);
      if ((it.timestamp || '') > existing.latest) existing.latest = it.timestamp || existing.latest;
      if (it.isUnread) existing.hasUnread = true;
      if (it.mentionsMe) existing.hasMention = true;
    } else {
      map.set(key, {
        key,
        label,
        blacklistToken: token,
        items: [it],
        latest: it.timestamp || '',
        hasUnread: !!it.isUnread,
        hasMention: !!it.mentionsMe,
      });
    }
  }
  const groups = Array.from(map.values());
  for (const g of groups) g.items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  groups.sort((a, b) => b.latest.localeCompare(a.latest));
  return groups;
}

