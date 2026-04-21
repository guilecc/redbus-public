import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  BrowserWindow: vi.fn(),
  Notification: Object.assign(vi.fn().mockImplementation(() => ({
    show: vi.fn(), on: vi.fn(),
  })), { isSupported: vi.fn().mockReturnValue(false) }),
}));

// Mock fetch globally
const mockFetch = vi.fn();
(global as any).fetch = mockFetch;

import { initializeDatabase } from '../electron/database';
import {
  getAgentState, setAgentState,
} from '../electron/services/orchestratorService';
import {
  evaluateProactivity,
  _setLastProactiveAt,
  _resetEngine,
  startProactivityEngine,
  stopProactivityEngine,
  getProactivityStatus,
  setProactivityLevel,
  getProactivityLevel,
  setLevelTiming,
  getLevelTimings,
} from '../electron/services/proactivityEngine';

// We need to mock sensorManager's getEnvironmentalContext
const mockEnvCtx = {
  clipboardText: null as string | null,
  clipboardCapturedAt: null as string | null,
  activeWindow: null as { appName: string; title: string } | null,
  activeWindowUpdatedAt: null as string | null,
  accessibilityTree: null,
  accessibilityTreeText: null,
};
vi.mock('../electron/services/sensorManager', () => ({
  getEnvironmentalContext: () => mockEnvCtx,
  initSensorManager: vi.fn(),
  toggleSensor: vi.fn(),
  getSensorStatuses: vi.fn(() => []),
  clearClipboardContext: vi.fn(),
  _resetSensorState: vi.fn(),
}));

describe('ProactivityEngine', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    vi.useFakeTimers();
    db = initializeDatabase(':memory:');
    // Insert a test API key so the cognitive filter can run
    db.prepare("UPDATE ProviderConfigs SET googleKey = 'test-key-123', roles = '{\"utility\":{\"model\":\"google/gemini-2.5-flash\"}}' WHERE id = 1").run();
    setAgentState('IDLE');
    _resetEngine();
    mockEnvCtx.clipboardText = null;
    mockEnvCtx.activeWindow = null;
    mockFetch.mockReset();
  });

  afterEach(() => {
    _resetEngine();
    db.close();
    vi.useRealTimers();
  });

  // ── agentState tests ──

  it('1. agentState should default to IDLE', () => {
    expect(getAgentState()).toBe('IDLE');
  });

  it('2. setAgentState should toggle state', () => {
    setAgentState('BUSY');
    expect(getAgentState()).toBe('BUSY');
    setAgentState('IDLE');
    expect(getAgentState()).toBe('IDLE');
  });

  // ── Early return: BUSY ──

  it('3. should NOT evaluate when agentState is BUSY', async () => {
    setAgentState('BUSY');
    const result = await evaluateProactivity();
    expect(result.spoke).toBe(false);
    expect(result.reason).toBe('BUSY');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Early return: COOLDOWN ──

  it('4. should NOT evaluate when cooldown is active', async () => {
    _setLastProactiveAt(Date.now() - 30 * 1000); // 30s ago (< 1 min HIGH cooldown)
    const result = await evaluateProactivity();
    expect(result.spoke).toBe(false);
    expect(result.reason).toContain('COOLDOWN');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('5. should allow evaluation after cooldown expires', async () => {
    _setLastProactiveAt(Date.now() - 3 * 60 * 1000); // 3 min ago (> 2 min MEDIUM cooldown)
    mockEnvCtx.activeWindow = { appName: 'Safari', title: 'Error 500 - Server Error' };

    // Mock LLM response: should NOT speak
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"should_speak": false, "message": "", "reason": "mundane"}' }] } }],
      }),
    });

    // Need to init the engine with DB
    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any);
    const result = await evaluateProactivity();
    expect(result.spoke).toBe(false);
    expect(result.reason).toBe('mundane');
  });

  // ── No context ──

  it('6. should return NO_CONTEXT when no sensors have data', async () => {
    const result = await evaluateProactivity();
    expect(result.spoke).toBe(false);
    expect(result.reason).toBe('NO_CONTEXT');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Successful proactive message ──

  it('7. should inject message into chat when LLM says should_speak=true', async () => {
    mockEnvCtx.activeWindow = { appName: 'Terminal', title: 'node — Error: ENOENT' };
    mockEnvCtx.clipboardText = 'Error: ENOENT: no such file or directory /tmp/missing.json';

    const mockSend = vi.fn();
    const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } } as any;
    startProactivityEngine(db, mockWindow);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"should_speak": true, "message": "Parece que o ficheiro /tmp/missing.json não existe. Quer que eu ajude a criar?", "reason": "ENOENT error visible"}' }] } }],
      }),
    });

    const result = await evaluateProactivity();
    expect(result.spoke).toBe(true);
    expect(result.reason).toBe('ENOENT error visible');

    // Verify message was saved to DB
    const msgs = db.prepare('SELECT * FROM ChatMessages WHERE type = ?').all('proactive');
    expect(msgs.length).toBe(1);
    expect((msgs[0] as any).role).toBe('assistant');
    expect((msgs[0] as any).content).toContain('missing.json');

    // Verify IPC was sent
    expect(mockSend).toHaveBeenCalledWith('chat:new-message', expect.objectContaining({
      role: 'assistant', type: 'proactive',
    }));

    // Verify state returned to IDLE
    expect(getAgentState()).toBe('IDLE');
  });

  // ── LLM error resilience ──

  it('8. should handle LLM errors gracefully without crashing', async () => {
    mockEnvCtx.activeWindow = { appName: 'Chrome', title: 'Some page' };
    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any);

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await evaluateProactivity();
    expect(result.spoke).toBe(false);
    expect(result.reason).toBe('ERROR');
    expect(getAgentState()).toBe('IDLE');
  });

  // ── Logging on early returns ──

  it('9. should log reason on every early return', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    setAgentState('BUSY');
    await evaluateProactivity();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ProactivityEngine] Skip: BUSY'));
    consoleSpy.mockRestore();
  });

  // ── getProactivityStatus ──

  it('10. getProactivityStatus should reflect engine state', async () => {
    const status1 = getProactivityStatus();
    expect(status1.running).toBe(false);
    expect(status1.lastEvalResult).toBeNull();

    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any);
    const status2 = getProactivityStatus();
    expect(status2.running).toBe(true);

    // Trigger an evaluation (will return NO_CONTEXT since no sensors have data)
    await evaluateProactivity();
    const status3 = getProactivityStatus();
    expect(status3.lastEvalResult).toEqual({ spoke: false, reason: 'NO_CONTEXT' });
    expect(status3.lastEvalAt).toBeTruthy();
  });

  // ── Custom cooldown ──

  it('11. should accept custom cooldown via startProactivityEngine', async () => {
    const customCooldown = 2 * 60 * 1000; // 2 minutes
    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any, customCooldown);

    const status = getProactivityStatus();
    expect(status.cooldownMs).toBe(customCooldown);

    // Set last proactive at 3 min ago — should pass cooldown with 2min setting
    _setLastProactiveAt(Date.now() - 3 * 60 * 1000);
    mockEnvCtx.activeWindow = { appName: 'VSCode', title: 'test.ts' };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"should_speak": false, "message": "", "reason": "just coding"}' }] } }],
      }),
    });

    const result = await evaluateProactivity();
    // Should NOT be COOLDOWN — it should have passed through to LLM
    expect(result.reason).not.toBe('COOLDOWN');
  });



  // ══════════════════════════════════════════════════
  // Proactivity Levels (OFF / LOW / MEDIUM / HIGH)
  // ══════════════════════════════════════════════════

  it('13. OFF level should block evaluation (no LLM call)', async () => {
    setProactivityLevel('OFF');
    mockEnvCtx.activeWindow = { appName: 'Chrome', title: 'Error 500' };
    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any);

    const result = await evaluateProactivity();
    expect(result.spoke).toBe(false);
    expect(result.reason).toBe('OFF');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('14. setProactivityLevel should update cooldown and status', () => {
    setProactivityLevel('HIGH');
    expect(getProactivityLevel()).toBe('HIGH');
    expect(getProactivityStatus().cooldownMs).toBe(1 * 60 * 1000);
    expect(getProactivityStatus().level).toBe('HIGH');

    setProactivityLevel('LOW');
    expect(getProactivityLevel()).toBe('LOW');
    expect(getProactivityStatus().cooldownMs).toBe(5 * 60 * 1000);

    setProactivityLevel('MEDIUM');
    expect(getProactivityStatus().cooldownMs).toBe(2 * 60 * 1000);
  });

  it('15. LOW cooldown (60min) should block if last proactive was 30min ago', async () => {
    setProactivityLevel('LOW');
    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any, undefined);
    // Force cooldown to LOW (60 min) — override any test param
    setProactivityLevel('LOW');

    _setLastProactiveAt(Date.now() - 2 * 60 * 1000); // 2 min ago (< 5 min LOW cooldown)
    mockEnvCtx.activeWindow = { appName: 'Terminal', title: 'Error' };

    const result = await evaluateProactivity();
    expect(result.reason).toContain('COOLDOWN');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('16. HIGH cooldown (10min) should allow if last proactive was 15min ago', async () => {
    setProactivityLevel('HIGH');
    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any);

    _setLastProactiveAt(Date.now() - 15 * 60 * 1000); // 15 min ago (> 10 min HIGH cooldown)
    mockEnvCtx.activeWindow = { appName: 'VSCode', title: 'app.tsx' };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"should_speak": false, "message": "", "reason": "user just coding"}' }] } }],
      }),
    });

    const result = await evaluateProactivity();
    // Should have passed COOLDOWN and reached the LLM
    expect(result.reason).not.toBe('COOLDOWN');
    expect(mockFetch).toHaveBeenCalled();
  });

  it('17. startProactivityEngine should restore level from DB', async () => {
    // Ensure AppSettings table exists and set the level
    db.exec(`CREATE TABLE IF NOT EXISTS AppSettings (key TEXT PRIMARY KEY, value TEXT)`);
    db.prepare(`INSERT OR REPLACE INTO AppSettings (key, value) VALUES ('proactivity_level', 'LOW')`).run();

    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any);
    expect(getProactivityLevel()).toBe('LOW');
    expect(getProactivityStatus().cooldownMs).toBe(5 * 60 * 1000);
  });

  it('18. _resetEngine should reset level to MEDIUM', () => {
    setProactivityLevel('HIGH');
    expect(getProactivityLevel()).toBe('HIGH');
    _resetEngine();
    expect(getProactivityLevel()).toBe('MEDIUM');
  });

  // ══════════════════════════════════════════════════
  // Configurable Timings
  // ══════════════════════════════════════════════════

  it('19. setLevelTiming should update custom interval and cooldown', () => {
    setLevelTiming('HIGH', 10_000, 30_000);
    const timings = getLevelTimings();
    expect(timings.HIGH.intervalMs).toBe(10_000);
    expect(timings.HIGH.cooldownMs).toBe(30_000);
  });

  it('20. setLevelTiming should apply immediately when changing current level', () => {
    setProactivityLevel('MEDIUM');
    setLevelTiming('MEDIUM', 5_000, 15_000);
    const status = getProactivityStatus();
    expect(status.cooldownMs).toBe(15_000);
    expect(status.intervalMs).toBe(5_000);
  });

  it('21. setProactivityLevel should restart setInterval when interval changes', () => {
    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any);
    expect(getProactivityStatus().running).toBe(true);

    setLevelTiming('HIGH', 5_000, 30_000);
    setProactivityLevel('HIGH');
    expect(getProactivityStatus().running).toBe(true);
    expect(getProactivityStatus().intervalMs).toBe(5_000);
  });

  it('22. custom timings should persist to DB and restore on start', () => {
    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any);
    setLevelTiming('HIGH', 8_000, 20_000);
    _resetEngine();

    // Restart engine — should restore from DB
    startProactivityEngine(db, { isDestroyed: () => false, webContents: { send: vi.fn() } } as any);
    const timings = getLevelTimings();
    expect(timings.HIGH.intervalMs).toBe(8_000);
    expect(timings.HIGH.cooldownMs).toBe(20_000);
  });

});

