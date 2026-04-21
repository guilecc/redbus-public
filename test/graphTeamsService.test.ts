import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  safeStorage: null,
}));

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

vi.mock('../electron/services/graph/graphAuthService', () => ({
  getMeId: vi.fn(() => 'me-id-42'),
}));

import { initializeDatabase } from '../electron/database';
import { fetchRecentChatMessages } from '../electron/services/graph/graphTeamsService';
import { listCommunications } from '../electron/services/communicationsStore';

describe('graphTeamsService — Spec 11 §9', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
    mockPaged.mockReset();
  });
  afterEach(() => { db.close(); });

  it('1. Lista /me/chats + itera /chats/{id}/messages', async () => {
    mockPaged
      .mockResolvedValueOnce([
        { id: 'chat-a', topic: 'Projeto X', chatType: 'group', lastMessagePreview: { createdDateTime: new Date().toISOString() } },
      ])
      .mockResolvedValueOnce([
        {
          id: 'm-1',
          messageType: 'message',
          body: { contentType: 'text', content: 'Olá pessoal' },
          from: { user: { id: 'u-1', displayName: 'Maria' } },
          createdDateTime: new Date().toISOString(),
          webUrl: 'https://teams.microsoft.com/chat/m-1',
        },
      ]);
    const n = await fetchRecentChatMessages(db);
    expect(n).toBe(1);
    const rows = listCommunications(db);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.source).toBe('teams');
    expect(r.graphId).toBe('m-1');
    expect(r.sender).toBe('Maria (Teams)');
    expect(r.channelOrChatName).toBe('Projeto X');
    expect(r.webLink).toBe('https://teams.microsoft.com/chat/m-1');
    expect(r.isUnread).toBe(true);
  });

  it('2. mentionsMe=true quando mentions[].mentioned.user.id === me.id', async () => {
    const now = new Date().toISOString();
    mockPaged
      .mockResolvedValueOnce([{ id: 'c1', chatType: 'oneOnOne', lastMessagePreview: { createdDateTime: now } }])
      .mockResolvedValueOnce([{
        id: 'm-mention',
        messageType: 'message',
        body: { contentType: 'text', content: 'oi' },
        from: { user: { id: 'other', displayName: 'Bob' } },
        createdDateTime: now,
        mentions: [{ mentioned: { user: { id: 'me-id-42' } } }],
      }]);
    await fetchRecentChatMessages(db);
    expect(listCommunications(db)[0].mentionsMe).toBe(true);
  });

  it('3. mentionsMe=false quando mention é outro usuário', async () => {
    const now = new Date().toISOString();
    mockPaged
      .mockResolvedValueOnce([{ id: 'c1', chatType: 'group', lastMessagePreview: { createdDateTime: now } }])
      .mockResolvedValueOnce([{
        id: 'm2', messageType: 'message',
        body: { contentType: 'text', content: 'oi' },
        from: { user: { id: 'o', displayName: 'X' } },
        createdDateTime: now,
        mentions: [{ mentioned: { user: { id: 'not-me' } } }],
      }]);
    await fetchRecentChatMessages(db);
    expect(listCommunications(db)[0].mentionsMe).toBe(false);
  });

  it('4. Ignora systemEventMessage', async () => {
    const now = new Date().toISOString();
    mockPaged
      .mockResolvedValueOnce([{ id: 'c1', chatType: 'group', lastMessagePreview: { createdDateTime: now } }])
      .mockResolvedValueOnce([
        { id: 'm-sys', messageType: 'systemEventMessage', body: { contentType: 'text', content: 'joined' }, createdDateTime: now },
        { id: 'm-real', messageType: 'message', body: { contentType: 'text', content: 'oi' }, from: { user: { displayName: 'A' } }, createdDateTime: now },
      ]);
    await fetchRecentChatMessages(db);
    const rows = listCommunications(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].graphId).toBe('m-real');
  });

  it('5. Colapsa importance "urgent" → "high"', async () => {
    const now = new Date().toISOString();
    mockPaged
      .mockResolvedValueOnce([{ id: 'c1', chatType: 'group', lastMessagePreview: { createdDateTime: now } }])
      .mockResolvedValueOnce([{
        id: 'm-urg', messageType: 'message',
        body: { contentType: 'text', content: 'urgente' },
        from: { user: { displayName: 'A' } },
        createdDateTime: now,
        importance: 'urgent',
      }]);
    await fetchRecentChatMessages(db);
    expect(listCommunications(db)[0].importance).toBe('high');
  });

  it('6. Pula chats cujo lastMessagePreview é anterior ao since', async () => {
    mockPaged.mockResolvedValueOnce([
      { id: 'old', chatType: 'group', lastMessagePreview: { createdDateTime: '2000-01-01T00:00:00Z' } },
    ]);
    // se pulou, não deve ter segunda chamada pra mensagens
    const n = await fetchRecentChatMessages(db, { since: '2026-04-01T00:00:00Z' });
    expect(n).toBe(0);
    expect(mockPaged).toHaveBeenCalledTimes(1);
  });

  it('7. Propaga falha ao listar /me/chats', async () => {
    mockPaged.mockRejectedValueOnce(new Error('chats_down'));
    await expect(fetchRecentChatMessages(db)).rejects.toThrow(/chats_down/);
  });

  it('8. Tolera falha em um chat específico e continua com o próximo', async () => {
    const now = new Date().toISOString();
    mockPaged
      .mockResolvedValueOnce([
        { id: 'bad', chatType: 'group', lastMessagePreview: { createdDateTime: now } },
        { id: 'good', chatType: 'group', lastMessagePreview: { createdDateTime: now } },
      ])
      .mockRejectedValueOnce(new Error('bad chat'))
      .mockResolvedValueOnce([{ id: 'm-ok', messageType: 'message', body: { contentType: 'text', content: 'oi' }, from: { user: { displayName: 'A' } }, createdDateTime: now }]);
    const n = await fetchRecentChatMessages(db);
    expect(n).toBe(1);
  });
});

