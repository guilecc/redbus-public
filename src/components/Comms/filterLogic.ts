import type { CommunicationItem } from '../../types/ipc';
import type { FilterState } from './FilterPanel';

/**
 * Spec 11 §6.3 — client-side filter pipeline.
 * Ordem: date → sources → unreadOnly → sameDomain → blacklist → (whitelist ∪ searchQuery) → timestamp DESC.
 *
 * `dateYMD` — optional `YYYY-MM-DD` filter. Items are matched by local-date of
 * their ISO timestamp (so the digest per-day semantics stay consistent with
 * what the user sees in the calendar).
 *
 * `userDomain` — authenticated user's email domain (e.g. `acme.com`). Only used
 * when `f.sameDomainOnly` is true; Outlook items whose `senderEmail` domain does
 * not match are filtered out. Teams items are not affected because Graph only
 * exposes `from.user.id`/`displayName` for chat messages (no email address).
 */
export function applyFilters(items: CommunicationItem[], f: FilterState, dateYMD?: string, userDomain?: string): CommunicationItem[] {
  const bl = f.blacklist.map(s => s.toLowerCase()).filter(Boolean);
  const wl = f.whitelist.map(s => s.toLowerCase()).filter(Boolean);
  const q = f.searchQuery.trim().toLowerCase();
  const effWl = q ? [...wl, q] : wl;
  const domain = (userDomain || '').trim().toLowerCase();
  const domainActive = !!f.sameDomainOnly && !!domain;

  const haystack = (i: CommunicationItem) => {
    const parts = [i.plainText || '', i.sender || '', i.subject || '', i.channelOrChatName || ''];
    return parts.join(' ').toLowerCase();
  };

  const domainOf = (email?: string): string => {
    if (!email) return '';
    const at = email.indexOf('@');
    return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
  };

  const localYMD = (iso: string): string => {
    try { const d = new Date(iso); if (isNaN(d.getTime())) return ''; const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${dd}`; } catch { return ''; }
  };

  const out: CommunicationItem[] = [];
  for (const i of items) {
    if (dateYMD && localYMD(i.timestamp || '') !== dateYMD) continue;
    if (!f.sources.outlook && i.source === 'outlook') continue;
    if (!f.sources.teams && i.source === 'teams') continue;
    if (f.unreadOnly && !i.isUnread) continue;
    if (domainActive && i.source === 'outlook' && domainOf(i.senderEmail) !== domain) continue;
    const h = haystack(i);
    if (bl.length > 0 && bl.some(t => h.includes(t))) continue;
    if (effWl.length > 0 && !effWl.some(t => h.includes(t))) continue;
    out.push(i);
  }
  out.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return out;
}

/** Extracts the domain portion of an email/UPN. Returns empty string when absent. */
export function extractDomain(email?: string): string {
  if (!email) return '';
  const at = email.indexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

