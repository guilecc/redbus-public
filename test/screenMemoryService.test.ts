import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
}));

import { initializeDatabase } from '../electron/database';
import {
  saveScreenCapture,
  searchScreenMemory,
  pruneOldScreenMemory,
  countScreenMemoryRecords,
} from '../electron/services/screenMemoryService';

describe('ScreenMemoryService', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  // ── saveScreenCapture ──

  it('1. should save a screen capture with extracted text', () => {
    const saved = saveScreenCapture(db, 'The quarterly revenue was $12M with a 15% growth rate.', 'Microsoft Excel', 'Q1_Report.xlsx');
    expect(saved).toBe(true);
    expect(countScreenMemoryRecords(db)).toBe(1);
  });

  it('2. should reject text shorter than 20 chars', () => {
    const saved = saveScreenCapture(db, 'short text');
    expect(saved).toBe(false);
    expect(countScreenMemoryRecords(db)).toBe(0);
  });

  it('3. should deduplicate identical text within 60 seconds', () => {
    const text = 'The quarterly revenue was $12M with a 15% growth rate.';
    saveScreenCapture(db, text, 'Excel');
    const saved2 = saveScreenCapture(db, text, 'Excel');
    expect(saved2).toBe(false);
    expect(countScreenMemoryRecords(db)).toBe(1);
  });

  it('4. should allow different text captures', () => {
    saveScreenCapture(db, 'First screen: Dashboard with KPI metrics');
    saveScreenCapture(db, 'Second screen: Email from John about the project deadline');
    expect(countScreenMemoryRecords(db)).toBe(2);
  });

  // ── searchScreenMemory (FTS5) ──

  it('5. should find text via FTS5 search', () => {
    saveScreenCapture(db, 'The quarterly revenue was $12M with a 15% growth rate.', 'Microsoft Excel', 'Q1_Report.xlsx');
    saveScreenCapture(db, 'Email from Alice: Please review the contract before Friday.');
    saveScreenCapture(db, 'Slack message from Bob: The deployment is scheduled for Monday.');

    const results = searchScreenMemory(db, 'revenue growth');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].snippet).toContain('revenue');
    expect(results[0].activeApp).toBe('Microsoft Excel');
  });

  it('6. should find email content via FTS5', () => {
    saveScreenCapture(db, 'Email from Alice: Please review the contract before Friday.');
    saveScreenCapture(db, 'Dashboard showing CPU usage at 85% and memory at 72%.');

    const results = searchScreenMemory(db, 'contract Friday');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].snippet).toContain('contract');
  });

  it('7. should return empty for no matches', () => {
    saveScreenCapture(db, 'Email from Alice: Please review the contract before Friday.');
    const results = searchScreenMemory(db, 'blockchain cryptocurrency');
    expect(results).toEqual([]);
  });

  it('8. should return empty for empty query', () => {
    const results = searchScreenMemory(db, '');
    expect(results).toEqual([]);
  });

  it('9. should limit results', () => {
    for (let i = 0; i < 10; i++) {
      saveScreenCapture(db, `Report number ${i}: Revenue data with growth metrics and KPI analysis version ${i}`);
    }
    const results = searchScreenMemory(db, 'revenue growth', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  // ── pruneOldScreenMemory ──

  it('10. should prune old records', () => {
    // Insert records with old timestamps
    db.prepare(`
      INSERT INTO ScreenMemory (timestamp, active_app, extracted_text, text_hash)
      VALUES (datetime('now', '-10 days'), 'Old App', 'Very old screen capture text that is long enough', 'hash_old')
    `).run();
    saveScreenCapture(db, 'Recent screen capture with enough text to be saved properly');

    expect(countScreenMemoryRecords(db)).toBe(2);
    const pruned = pruneOldScreenMemory(db);
    expect(pruned).toBe(1);
    expect(countScreenMemoryRecords(db)).toBe(1);
  });

  // ── Integration: save + search ──

  it('11. should search with app context', () => {
    saveScreenCapture(db, 'Error: Connection refused on port 5432. PostgreSQL is not running.', 'Terminal', 'zsh');
    saveScreenCapture(db, 'The meeting is scheduled for 3pm tomorrow with the product team.', 'Calendar', 'March');

    const results = searchScreenMemory(db, 'error connection PostgreSQL');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].activeApp).toBe('Terminal');
  });
});

