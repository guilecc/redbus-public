import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
}));

import {
  initializeDatabase,
  getAppSetting,
  setAppSetting,
  cleanupOldMemories,
} from '../electron/database';

describe('Data Retention (Perpetual MemPalace)', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  // ── AppSettings ──

  it('1. should NOT have default data_retention_days', () => {
    const val = getAppSetting(db, 'data_retention_days');
    expect(val).toBeNull();
  });

  it('2. should still allow setting other app settings', () => {
    setAppSetting(db, 'test_setting', 'hello');
    expect(getAppSetting(db, 'test_setting')).toBe('hello');
  });

  // ── cleanupOldMemories ──

  it('3. should delete ScreenMemory records older than 90 days ONLY', () => {
    // Insert very old record (100 days ago) -> should be deleted
    db.prepare(`
      INSERT INTO ScreenMemory (timestamp, active_app, extracted_text, text_hash)
      VALUES (datetime('now', '-100 days'), 'OldApp', 'Very old screen capture text', 'hash_old')
    `).run();

    // Insert record from 10 days ago -> should be KEPT (new 90-day rule)
    db.prepare(`
      INSERT INTO ScreenMemory (timestamp, active_app, extracted_text, text_hash)
      VALUES (datetime('now', '-10 days'), 'MidApp', 'Mid-age capture text', 'hash_mid')
    `).run();

    const count = db.prepare('SELECT COUNT(*) as c FROM ScreenMemory').get() as any;
    expect(count.c).toBe(2);

    const deleted = cleanupOldMemories(db);
    expect(deleted).toBe(1);

    const remaining = db.prepare('SELECT id, active_app FROM ScreenMemory').all() as any[];
    expect(remaining.length).toBe(1);
    expect(remaining[0].active_app).toBe('MidApp');
  });

  it('4. should delete old RoutineExecutions (> 90 days)', () => {
    db.prepare("INSERT INTO Conversations (id, title) VALUES ('c1', 'test')").run();
    db.prepare("INSERT INTO LivingSpecs (id, conversationId, status, specJson) VALUES ('spec1', 'c1', 'COMPLETED', '{}')").run();

    // Old execution (95 days)
    db.prepare(`
      INSERT INTO RoutineExecutions (id, specId, startedAt, endedAt, status)
      VALUES ('re1', 'spec1', datetime('now', '-95 days'), datetime('now', '-95 days'), 'ok')
    `).run();

    // Recent execution (10 days)
    db.prepare(`
      INSERT INTO RoutineExecutions (id, specId, startedAt, endedAt, status)
      VALUES ('re2', 'spec1', datetime('now', '-10 days'), datetime('now', '-10 days'), 'ok')
    `).run();

    const deleted = cleanupOldMemories(db);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = db.prepare('SELECT id FROM RoutineExecutions').all() as any[];
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('re2');
  });

  it('5. should NEVER delete ChatMessages despite age (MemPalace Policy)', () => {
    // Very old message (1 year ago)
    db.prepare(`
      INSERT INTO ChatMessages (id, role, content, createdAt)
      VALUES ('m1', 'user', 'Old message', datetime('now', '-365 days'))
    `).run();

    cleanupOldMemories(db);

    const msg = db.prepare("SELECT id FROM ChatMessages WHERE id = 'm1'").get() as any;
    expect(msg).toBeDefined();
    expect(msg.id).toBe('m1');
  });

  it('6. should return 0 when nothing is older than 90 days', () => {
    db.prepare(`
      INSERT INTO ScreenMemory (timestamp, active_app, extracted_text, text_hash)
      VALUES (datetime('now', '-80 days'), 'App', 'Recent enough', 'hash_recent')
    `).run();

    const deleted = cleanupOldMemories(db);
    expect(deleted).toBe(0);
  });

  it('7. should handle VACUUM gracefully', () => {
    db.prepare(`
      INSERT INTO ScreenMemory (timestamp, active_app, extracted_text, text_hash)
      VALUES (datetime('now', '-100 days'), 'App', 'Old text', 'hash_auto')
    `).run();

    expect(() => cleanupOldMemories(db)).not.toThrow();
  });
});
