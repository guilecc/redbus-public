/**
 * Tests for searchDigestMemory — Format J native digest search.
 *
 * Uses an in-memory SQLite DB to validate filter combinations:
 * - string query (full-text on summary_json)
 * - object query with channel, date_filter, and text query
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  saveDigest,
  searchDigestMemory,
  DigestSummary,
  DigestMessage,
} from '../electron/services/digestService';

function createDb(): any {
  const db = new Database(':memory:');
  db.prepare(`
    CREATE TABLE CommunicationDigest (
      id TEXT PRIMARY KEY,
      digest_date TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'all',
      total_messages INTEGER DEFAULT 0,
      summary_json TEXT,
      raw_messages_json TEXT,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  return db;
}

function makeSummary(overrides: Partial<DigestSummary> = {}): DigestSummary {
  return {
    executive_summary: 'Resumo do dia.',
    topics: [{ title: 'Projeto Alpha', summary: 'Atualização de sprint.', messages: [], priority: 'high' }],
    action_items: ['Responder João sobre orçamento'],
    total_messages: 5,
    channels: ['outlook'],
    ...overrides,
  };
}

describe('searchDigestMemory', () => {
  let db: any;

  beforeEach(() => {
    db = createDb();
  });

  it('returns empty array when no digests exist', () => {
    const results = searchDigestMemory(db, { date_filter: 'today' });
    expect(results).toHaveLength(0);
  });

  it('finds digest by text query (string overload)', () => {
    const summary = makeSummary({ executive_summary: 'Atualização crítica da infra.' });
    saveDigest(db, '2026-03-20', 'all', summary, []);

    const results = searchDigestMemory(db, 'infra');
    expect(results).toHaveLength(1);
    expect(results[0].digest_date).toBe('2026-03-20');
  });

  it('finds digest by object query text', () => {
    const summary = makeSummary({ executive_summary: 'Reunião de planejamento Q2.' });
    saveDigest(db, '2026-03-21', 'all', summary, []);
    saveDigest(db, '2026-03-20', 'all', makeSummary(), []);

    const results = searchDigestMemory(db, { query: 'planejamento' });
    expect(results).toHaveLength(1);
    expect(results[0].digest_date).toBe('2026-03-21');
  });

  it('filters by channel', () => {
    saveDigest(db, '2026-03-22', 'outlook', makeSummary(), []);
    saveDigest(db, '2026-03-22', 'teams', makeSummary(), []);

    const outlookResults = searchDigestMemory(db, { channel: 'outlook' });
    expect(outlookResults).toHaveLength(1);
    expect(outlookResults[0].channel).toBe('outlook');

    const teamsResults = searchDigestMemory(db, { channel: 'teams' });
    expect(teamsResults).toHaveLength(1);
    expect(teamsResults[0].channel).toBe('teams');
  });

  it('channel=all does not filter', () => {
    saveDigest(db, '2026-03-22', 'outlook', makeSummary(), []);
    saveDigest(db, '2026-03-22', 'teams', makeSummary(), []);

    const results = searchDigestMemory(db, { channel: 'all' });
    expect(results).toHaveLength(2);
  });

  it('filters this_week returns recent digests', () => {
    // Insert one with a very old date
    saveDigest(db, '2020-01-01', 'all', makeSummary({ executive_summary: 'very old' }), []);
    // Insert one recent (use today for reliable test)
    const today = new Date().toISOString().slice(0, 10);
    saveDigest(db, today, 'all', makeSummary({ executive_summary: 'recente' }), []);

    const results = searchDigestMemory(db, { date_filter: 'this_week' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.digest_date === today)).toBe(true);
    expect(results.every(r => r.digest_date >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))).toBe(true);
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      saveDigest(db, `2026-03-${String(i + 1).padStart(2, '0')}`, 'all', makeSummary(), []);
    }
    const results = searchDigestMemory(db, {}, 3);
    expect(results).toHaveLength(3);
  });

  it('returns most recent first (DESC order)', () => {
    saveDigest(db, '2026-03-01', 'all', makeSummary(), []);
    saveDigest(db, '2026-03-23', 'all', makeSummary(), []);
    saveDigest(db, '2026-03-15', 'all', makeSummary(), []);

    const results = searchDigestMemory(db, {});
    expect(results[0].digest_date).toBe('2026-03-23');
    expect(results[results.length - 1].digest_date).toBe('2026-03-01');
  });

  it('combines channel and query filters', () => {
    saveDigest(db, '2026-03-22', 'outlook', makeSummary({ executive_summary: 'Alerta de compliance' }), []);
    saveDigest(db, '2026-03-22', 'teams', makeSummary({ executive_summary: 'Alerta de compliance' }), []);

    const results = searchDigestMemory(db, { channel: 'outlook', query: 'compliance' });
    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe('outlook');
  });
});
