import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  safeStorage: null,
}));

import { initializeDatabase } from '../electron/database';
import {
  upsertCommunication,
  upsertMany,
  listCommunications,
  getCommunicationsByIds,
  getLastTimestamp,
  sweepOld,
  clearAll,
} from '../electron/services/communicationsStore';

function baseItem(o: Partial<any> = {}) {
  return {
    graphId: 'g1',
    source: 'outlook' as const,
    sender: 'Fulano <f@x.com>',
    senderEmail: 'f@x.com',
    subject: 'oi',
    plainText: 'corpo',
    timestamp: '2026-04-15T10:00:00Z',
    isUnread: true,
    importance: 'normal' as const,
    mentionsMe: false,
    ...o,
  };
}

describe('communicationsStore — Spec 11 §3.2', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => { db = initializeDatabase(':memory:'); });
  afterEach(() => { db.close(); });

  it('1. Insere nova row quando graph_id não existe (returns true)', () => {
    const inserted = upsertCommunication(db, baseItem());
    expect(inserted).toBe(true);
    const rows = listCommunications(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].graphId).toBe('g1');
    expect(rows[0].sender).toBe('Fulano <f@x.com>');
    expect(rows[0].isUnread).toBe(true);
  });

  it('2. Dedup por graph_id — upsert sobrescreve campos (returns false)', () => {
    upsertCommunication(db, baseItem({ subject: 'v1', plainText: 'old' }));
    const second = upsertCommunication(db, baseItem({ subject: 'v2', plainText: 'new', isUnread: false }));
    expect(second).toBe(false);
    const rows = listCommunications(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('v2');
    expect(rows[0].plainText).toBe('new');
    expect(rows[0].isUnread).toBe(false);
  });

  it('3. upsertMany conta apenas novos inseridos em batch com duplicatas', () => {
    upsertCommunication(db, baseItem({ graphId: 'a' }));
    const n = upsertMany(db, [
      baseItem({ graphId: 'a', subject: 'updated' }),
      baseItem({ graphId: 'b' }),
      baseItem({ graphId: 'c' }),
    ]);
    expect(n).toBe(2);
    expect(listCommunications(db)).toHaveLength(3);
  });

  it('4. listCommunications ordena por timestamp DESC', () => {
    upsertCommunication(db, baseItem({ graphId: 'a', timestamp: '2026-04-10T00:00:00Z' }));
    upsertCommunication(db, baseItem({ graphId: 'b', timestamp: '2026-04-15T00:00:00Z' }));
    upsertCommunication(db, baseItem({ graphId: 'c', timestamp: '2026-04-12T00:00:00Z' }));
    const rows = listCommunications(db);
    expect(rows.map(r => r.graphId)).toEqual(['b', 'c', 'a']);
  });

  it('5. Filtro por source restringe a outlook/teams', () => {
    upsertCommunication(db, baseItem({ graphId: 'a', source: 'outlook' }));
    upsertCommunication(db, baseItem({ graphId: 'b', source: 'teams' }));
    const outlookOnly = listCommunications(db, { sources: ['outlook'] });
    expect(outlookOnly).toHaveLength(1);
    expect(outlookOnly[0].source).toBe('outlook');
    const both = listCommunications(db, { sources: ['outlook', 'teams'] });
    expect(both).toHaveLength(2);
  });

  it('6. Filtro por since corta timestamps anteriores', () => {
    upsertCommunication(db, baseItem({ graphId: 'old', timestamp: '2026-04-01T00:00:00Z' }));
    upsertCommunication(db, baseItem({ graphId: 'new', timestamp: '2026-04-18T00:00:00Z' }));
    const rows = listCommunications(db, { since: '2026-04-10T00:00:00Z' });
    expect(rows.map(r => r.graphId)).toEqual(['new']);
  });

  it('7. getCommunicationsByIds retorna subset e [] para lista vazia', () => {
    upsertCommunication(db, baseItem({ graphId: 'a' }));
    upsertCommunication(db, baseItem({ graphId: 'b' }));
    const rows = listCommunications(db);
    const subset = getCommunicationsByIds(db, [rows[0].id]);
    expect(subset).toHaveLength(1);
    expect(getCommunicationsByIds(db, [])).toEqual([]);
  });

  it('8. getLastTimestamp retorna o mais recente por source', () => {
    upsertCommunication(db, baseItem({ graphId: 'a', source: 'outlook', timestamp: '2026-04-01T00:00:00Z' }));
    upsertCommunication(db, baseItem({ graphId: 'b', source: 'outlook', timestamp: '2026-04-15T00:00:00Z' }));
    upsertCommunication(db, baseItem({ graphId: 'c', source: 'teams', timestamp: '2026-04-10T00:00:00Z' }));
    expect(getLastTimestamp(db, 'outlook')).toBe('2026-04-15T00:00:00Z');
    expect(getLastTimestamp(db, 'teams')).toBe('2026-04-10T00:00:00Z');
  });

  it('9. getLastTimestamp retorna null quando source está vazio', () => {
    expect(getLastTimestamp(db, 'outlook')).toBeNull();
  });

  it('10. sweepOld remove rows anteriores ao cutoff (TTL 14d)', () => {
    upsertCommunication(db, baseItem({ graphId: 'old', timestamp: '2000-01-01T00:00:00Z' }));
    upsertCommunication(db, baseItem({ graphId: 'new', timestamp: new Date().toISOString() }));
    const removed = sweepOld(db, 14);
    expect(removed).toBe(1);
    const rows = listCommunications(db);
    expect(rows.map(r => r.graphId)).toEqual(['new']);
  });

  it('11. Persistência de importance + mentionsMe + webLink', () => {
    upsertCommunication(db, baseItem({
      graphId: 'x',
      importance: 'high',
      mentionsMe: true,
      webLink: 'https://outlook.office.com/mail/x',
    }));
    const r = listCommunications(db)[0];
    expect(r.importance).toBe('high');
    expect(r.mentionsMe).toBe(true);
    expect(r.webLink).toBe('https://outlook.office.com/mail/x');
  });

  it('12. clearAll apaga todas as rows', () => {
    upsertMany(db, [baseItem({ graphId: 'a' }), baseItem({ graphId: 'b' })]);
    clearAll(db);
    expect(listCommunications(db)).toHaveLength(0);
  });
});

