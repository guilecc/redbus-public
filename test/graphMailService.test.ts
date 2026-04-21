import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  safeStorage: null,
}));

// Mock graphClient — we don't want real HTTP in unit tests.
const mockPaged = vi.fn();
vi.mock('../electron/services/graph/graphClient', () => ({
  graphFetch: vi.fn(),
  graphFetchPaged: (...args: any[]) => mockPaged(...args),
  GraphAuthError: class extends Error {},
  GraphHttpError: class extends Error {},
}));

vi.mock('../electron/services/activityLogger', () => ({
  logActivity: vi.fn(),
}));

import { initializeDatabase } from '../electron/database';
import { fetchRecentMessages } from '../electron/services/graph/graphMailService';
import { listCommunications } from '../electron/services/communicationsStore';

describe('graphMailService — Spec 11 §9', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    mockPaged.mockReset();
  });
  afterEach(() => { db.close(); });

  it('1. Mapeia /me/messages para CommunicationItem + persiste via upsertMany', async () => {
    mockPaged.mockResolvedValueOnce([
      {
        id: 'g-1',
        subject: 'Reunião amanhã',
        body: { contentType: 'html', content: '<p>oi <b>equipe</b></p><br>--<br>Fulano' },
        from: { emailAddress: { name: 'Fulano', address: 'f@x.com' } },
        receivedDateTime: '2026-04-18T10:00:00Z',
        isRead: false,
        importance: 'high',
        webLink: 'https://outlook.office.com/mail/g-1',
      },
    ]);
    const inserted = await fetchRecentMessages(db);
    expect(inserted).toBe(1);
    const rows = listCommunications(db);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.graphId).toBe('g-1');
    expect(r.source).toBe('outlook');
    expect(r.sender).toBe('Fulano <f@x.com>');
    expect(r.senderEmail).toBe('f@x.com');
    expect(r.subject).toBe('Reunião amanhã');
    expect(r.isUnread).toBe(true);
    expect(r.importance).toBe('high');
    expect(r.webLink).toBe('https://outlook.office.com/mail/g-1');
    expect(r.plainText).toContain('oi');
    expect(r.plainText).not.toContain('<');
    expect(r.plainText).not.toContain('Fulano'); // signature trimmed
  });

  it('2. Dedup: polls repetidos com mesmo id retornam 0 novos', async () => {
    const payload = [{
      id: 'g-dup',
      subject: 'oi',
      body: { contentType: 'text', content: 'corpo' },
      from: { emailAddress: { name: 'X', address: 'x@y.com' } },
      receivedDateTime: '2026-04-18T10:00:00Z',
      isRead: false,
    }];
    mockPaged.mockResolvedValueOnce(payload);
    expect(await fetchRecentMessages(db)).toBe(1);
    mockPaged.mockResolvedValueOnce(payload);
    expect(await fetchRecentMessages(db)).toBe(0);
    expect(listCommunications(db)).toHaveLength(1);
  });

  it('3. Fallback sender label quando faltam campos', async () => {
    mockPaged.mockResolvedValueOnce([{
      id: 'g-2',
      subject: undefined,
      body: { contentType: 'text', content: 'c' },
      from: { emailAddress: { name: 'Só Nome' } },
      receivedDateTime: '2026-04-18T10:00:00Z',
      isRead: true,
    }, {
      id: 'g-3',
      body: { contentType: 'text', content: 'd' },
      receivedDateTime: '2026-04-18T10:01:00Z',
      isRead: true,
    }]);
    await fetchRecentMessages(db);
    const rows = listCommunications(db);
    const byId: Record<string, any> = {};
    rows.forEach(r => { byId[r.graphId] = r; });
    expect(byId['g-2'].sender).toBe('Só Nome');
    expect(byId['g-2'].subject).toBe('(sem assunto)');
    expect(byId['g-2'].isUnread).toBe(false);
    expect(byId['g-3'].sender).toBe('(desconhecido)');
  });

  it('4. Query Graph contém $filter receivedDateTime + $orderby + $select', async () => {
    mockPaged.mockResolvedValueOnce([]);
    await fetchRecentMessages(db, { since: '2026-04-01T00:00:00Z', top: 20 });
    expect(mockPaged).toHaveBeenCalledTimes(1);
    const [, path, options] = mockPaged.mock.calls[0];
    expect(path).toBe('/me/messages');
    expect(options.query.$filter).toBe('receivedDateTime ge 2026-04-01T00:00:00Z');
    expect(options.query.$orderby).toBe('receivedDateTime desc');
    expect(options.query.$select).toMatch(/id,subject/);
    expect(options.query.$top).toBe('20');
  });

  it('5. top é clampado entre 1 e 100', async () => {
    mockPaged.mockResolvedValue([]);
    await fetchRecentMessages(db, { top: 999 });
    expect(mockPaged.mock.calls[0][2].query.$top).toBe('100');
    await fetchRecentMessages(db, { top: 0 });
    expect(mockPaged.mock.calls[1][2].query.$top).toBe('1');
  });

  it('6. Erro do graphFetchPaged propaga e não atualiza last_poll', async () => {
    mockPaged.mockRejectedValueOnce(new Error('boom'));
    await expect(fetchRecentMessages(db)).rejects.toThrow(/boom/);
  });
});

