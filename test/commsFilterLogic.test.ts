import { describe, it, expect } from 'vitest';
import { applyFilters } from '../src/components/Comms/filterLogic';
import type { FilterState } from '../src/components/Comms/FilterPanel';
import type { CommunicationItem } from '../src/types/ipc';

function item(o: Partial<CommunicationItem>): CommunicationItem {
  return {
    id: o.id || Math.random().toString(36).slice(2),
    graphId: o.graphId || o.id || 'g',
    source: o.source || 'outlook',
    sender: o.sender || 'Fulano',
    senderEmail: o.senderEmail,
    subject: o.subject,
    channelOrChatName: o.channelOrChatName,
    plainText: o.plainText || '',
    timestamp: o.timestamp || '2026-04-15T00:00:00Z',
    isUnread: o.isUnread ?? true,
    webLink: o.webLink,
    importance: o.importance,
    mentionsMe: o.mentionsMe,
  };
}

const emptyFilter: FilterState = {
  blacklist: [],
  whitelist: [],
  sources: { outlook: true, teams: true },
  unreadOnly: false,
  sameDomainOnly: false,
  searchQuery: '',
};

describe('commsFilterLogic — Spec 11 §6.3', () => {
  it('1. Retorna tudo quando filtros vazios, ordenado por timestamp DESC', () => {
    const items = [
      item({ id: 'a', timestamp: '2026-04-10T00:00:00Z' }),
      item({ id: 'b', timestamp: '2026-04-18T00:00:00Z' }),
      item({ id: 'c', timestamp: '2026-04-12T00:00:00Z' }),
    ];
    const out = applyFilters(items, emptyFilter);
    expect(out.map(i => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('2. sources toggles removem outlook/teams', () => {
    const items = [
      item({ id: 'o', source: 'outlook' }),
      item({ id: 't', source: 'teams' }),
    ];
    expect(applyFilters(items, { ...emptyFilter, sources: { outlook: true, teams: false } }).map(i => i.id)).toEqual(['o']);
    expect(applyFilters(items, { ...emptyFilter, sources: { outlook: false, teams: true } }).map(i => i.id)).toEqual(['t']);
    expect(applyFilters(items, { ...emptyFilter, sources: { outlook: false, teams: false } })).toEqual([]);
  });

  it('3. unreadOnly mantém só isUnread=true', () => {
    const items = [
      item({ id: 'u', isUnread: true }),
      item({ id: 'r', isUnread: false }),
    ];
    expect(applyFilters(items, { ...emptyFilter, unreadOnly: true }).map(i => i.id)).toEqual(['u']);
  });

  it('4. blacklist case-insensitive remove matches em plainText/sender/subject', () => {
    const items = [
      item({ id: 'spam', sender: 'Newsletter Weekly', subject: 'oi', plainText: 'promo' }),
      item({ id: 'ok', sender: 'Maria', subject: 'ticket', plainText: 'conteúdo' }),
    ];
    const out = applyFilters(items, { ...emptyFilter, blacklist: ['NEWSLETTER'] });
    expect(out.map(i => i.id)).toEqual(['ok']);
  });

  it('5. whitelist restringe a items que contêm PELO MENOS UM termo', () => {
    const items = [
      item({ id: 'a', plainText: 'relatório financeiro Q1' }),
      item({ id: 'b', plainText: 'deploy staging' }),
      item({ id: 'c', subject: 'bug em produção' }),
    ];
    const out = applyFilters(items, { ...emptyFilter, whitelist: ['bug', 'relatório'] });
    expect(out.map(i => i.id).sort()).toEqual(['a', 'c']);
  });

  it('6. searchQuery é adicionado à whitelist (união)', () => {
    const items = [
      item({ id: 'wl', plainText: 'relatório mensal' }),
      item({ id: 'sq', subject: 'deploy prod' }),
      item({ id: 'other', plainText: 'almoço' }),
    ];
    const out = applyFilters(items, { ...emptyFilter, whitelist: ['relatório'], searchQuery: 'deploy' });
    expect(out.map(i => i.id).sort()).toEqual(['sq', 'wl']);
  });

  it('7. blacklist tem precedência sobre whitelist', () => {
    const items = [
      item({ id: 'x', sender: 'Ops Team', subject: 'deploy noturno', plainText: 'deploy' }),
    ];
    const out = applyFilters(items, { ...emptyFilter, whitelist: ['deploy'], blacklist: ['ops team'] });
    expect(out).toHaveLength(0);
  });

  it('8. Ordem DESC estável por timestamp string ISO', () => {
    const items = [
      item({ id: 'a', timestamp: '2026-04-10T09:00:00Z' }),
      item({ id: 'b', timestamp: '2026-04-10T10:00:00Z' }),
    ];
    expect(applyFilters(items, emptyFilter).map(i => i.id)).toEqual(['b', 'a']);
  });

  it('9. Entrada vazia retorna array vazio', () => {
    expect(applyFilters([], emptyFilter)).toEqual([]);
  });

  it('10. whitelist + searchQuery: se whitelist vazia e searchQuery set, só busca vale', () => {
    const items = [
      item({ id: 'm', subject: 'match important' }),
      item({ id: 'n', subject: 'outro' }),
    ];
    const out = applyFilters(items, { ...emptyFilter, searchQuery: 'important' });
    expect(out.map(i => i.id)).toEqual(['m']);
  });

  it('11. sameDomainOnly filtra Outlook por domínio, não afeta Teams', () => {
    const items = [
      item({ id: 'int', source: 'outlook', senderEmail: 'colega@acme.com' }),
      item({ id: 'ext', source: 'outlook', senderEmail: 'cliente@externa.com' }),
      item({ id: 'nomail', source: 'outlook', senderEmail: undefined }),
      item({ id: 'teams', source: 'teams', senderEmail: undefined }),
    ];
    const out = applyFilters(items, { ...emptyFilter, sameDomainOnly: true }, undefined, 'acme.com');
    expect(out.map(i => i.id).sort()).toEqual(['int', 'teams']);
  });

  it('12. sameDomainOnly sem userDomain é no-op (não filtra)', () => {
    const items = [
      item({ id: 'a', senderEmail: 'x@y.com' }),
      item({ id: 'b', senderEmail: undefined }),
    ];
    const out = applyFilters(items, { ...emptyFilter, sameDomainOnly: true }, undefined, '');
    expect(out.map(i => i.id).sort()).toEqual(['a', 'b']);
  });

  it('13. sameDomainOnly case-insensitive no domínio', () => {
    const items = [
      item({ id: 'a', source: 'outlook', senderEmail: 'Alice@ACME.com' }),
      item({ id: 'b', source: 'outlook', senderEmail: 'bob@other.io' }),
    ];
    const out = applyFilters(items, { ...emptyFilter, sameDomainOnly: true }, undefined, 'acme.COM');
    expect(out.map(i => i.id)).toEqual(['a']);
  });
});

