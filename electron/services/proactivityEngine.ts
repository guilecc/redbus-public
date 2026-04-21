/**
 * ProactivityEngine — The "Subconscious" of RedBus.
 *
 * Background loop that periodically evaluates environmental context
 * (clipboard, active window, OCR screen memory) and decides whether
 * the agent should autonomously initiate a conversation.
 *
 * Safety: Never interrupts BUSY state. Configurable cooldown. Cognitive LLM filter.
 */

import { v4 as uuidv4 } from 'uuid';
import { getAgentState, setAgentState } from './orchestratorService';
import { getEnvironmentalContext, toggleSensor, getSensorStatuses } from './sensorManager';
import { resolveRole, chatWithRole } from './roles';
import { saveMessage } from './archiveService';
import { sendOSNotification } from './notificationService';
import { getAppSetting, setAppSetting } from '../database';
import { BrowserWindow } from 'electron';
import { logActivity } from './activityLogger';

/* ── Proactivity Levels ── */
export type ProactivityLevel = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';

const DEFAULT_COOLDOWN_BY_LEVEL: Record<ProactivityLevel, number> = {
    OFF: Infinity,                // never
    LOW: 5 * 60 * 1000,          // 5 minutes
    MEDIUM: 2 * 60 * 1000,       // 2 minutes
    HIGH: 1 * 60 * 1000,         // 1 minute
};

const DEFAULT_INTERVAL_BY_LEVEL: Record<ProactivityLevel, number> = {
    OFF: 3 * 60 * 1000,          // irrelevant (OFF)
    LOW: 2 * 60 * 1000,          // 2 minutes
    MEDIUM: 1 * 60 * 1000,       // 1 minute
    HIGH: 30 * 1000,             // 30 seconds
};

/* ── Custom timings (overridden per level via AppSettings) ── */
let _customCooldowns: Partial<Record<ProactivityLevel, number>> = {};
let _customIntervals: Partial<Record<ProactivityLevel, number>> = {};

/* ── Configuration ── */
let _intervalMs = DEFAULT_INTERVAL_BY_LEVEL.MEDIUM;
const DEFAULT_COOLDOWN_MS = DEFAULT_COOLDOWN_BY_LEVEL.MEDIUM;

/* ── State ── */
let _timer: ReturnType<typeof setInterval> | null = null;
let _lastProactiveAt = 0;
let _db: any = null;
let _mainWindow: BrowserWindow | null = null;
let _cooldownMs = DEFAULT_COOLDOWN_MS;
let _level: ProactivityLevel = 'MEDIUM';

/* ── Observable status (exposed via IPC) ── */
export interface ProactivityStatus {
    running: boolean;
    level: ProactivityLevel;
    lastEvalResult: { spoke: boolean; reason?: string } | null;
    lastEvalAt: string | null;
    lastProactiveAt: string | null;
    cooldownMs: number;
    intervalMs: number;
    sensorsActive: string[];
}

let _lastEvalResult: { spoke: boolean; reason?: string } | null = null;
let _lastEvalAt: string | null = null;

export function getProactivityStatus(): ProactivityStatus {
    return {
        running: _timer !== null,
        level: _level,
        lastEvalResult: _lastEvalResult,
        lastEvalAt: _lastEvalAt,
        lastProactiveAt: _lastProactiveAt > 0 ? new Date(_lastProactiveAt).toISOString() : null,
        cooldownMs: _cooldownMs,
        intervalMs: _intervalMs,
        sensorsActive: [],  // filled by caller if needed
    };
}

/**
 * Set proactivity level at runtime. Updates cooldown, interval and restarts loop.
 */
export function setProactivityLevel(level: ProactivityLevel): void {
    _level = level;
    _cooldownMs = _customCooldowns[level] ?? DEFAULT_COOLDOWN_BY_LEVEL[level];
    const newInterval = _customIntervals[level] ?? DEFAULT_INTERVAL_BY_LEVEL[level];
    const intervalChanged = newInterval !== _intervalMs;
    _intervalMs = newInterval;
    console.log(`[ProactivityEngine] Level set to ${level} (cooldown: ${_cooldownMs / 1000}s, interval: ${_intervalMs / 1000}s)`);
    logActivity('proactivity', `Nível de proatividade alterado para ${level}`);

    // Restart the setInterval if interval changed and engine is running
    if (intervalChanged && _timer) {
        _restartLoop();
    }
}

/**
 * Set custom timing for a specific level. Persists to DB if available.
 */
export function setLevelTiming(level: ProactivityLevel, intervalMs?: number, cooldownMs?: number): void {
    if (intervalMs !== undefined) _customIntervals[level] = intervalMs;
    if (cooldownMs !== undefined) _customCooldowns[level] = cooldownMs;

    // Persist to DB
    if (_db) {
        try {
            if (intervalMs !== undefined) setAppSetting(_db, `proactivity_interval_${level}`, String(intervalMs));
            if (cooldownMs !== undefined) setAppSetting(_db, `proactivity_cooldown_${level}`, String(cooldownMs));
        } catch { /* ignore */ }
    }

    // Apply immediately if this is the current level
    if (level === _level) {
        if (cooldownMs !== undefined) _cooldownMs = cooldownMs;
        if (intervalMs !== undefined) {
            const changed = intervalMs !== _intervalMs;
            _intervalMs = intervalMs;
            if (changed && _timer) _restartLoop();
        }
    }
    console.log(`[ProactivityEngine] Timing for ${level}: interval=${(intervalMs ?? _customIntervals[level] ?? DEFAULT_INTERVAL_BY_LEVEL[level]) / 1000}s, cooldown=${(cooldownMs ?? _customCooldowns[level] ?? DEFAULT_COOLDOWN_BY_LEVEL[level]) / 1000}s`);
}

/**
 * Get current timings for all levels.
 */
export function getLevelTimings(): Record<ProactivityLevel, { intervalMs: number; cooldownMs: number }> {
    const result = {} as any;
    for (const lvl of ['OFF', 'LOW', 'MEDIUM', 'HIGH'] as ProactivityLevel[]) {
        result[lvl] = {
            intervalMs: _customIntervals[lvl] ?? DEFAULT_INTERVAL_BY_LEVEL[lvl],
            cooldownMs: _customCooldowns[lvl] ?? DEFAULT_COOLDOWN_BY_LEVEL[lvl],
        };
    }
    return result;
}

export function getProactivityLevel(): ProactivityLevel {
    return _level;
}

let _tickCount = 0;

/** Restart the interval loop with the current _intervalMs */
function _restartLoop(): void {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _tickCount = 0;
    _timer = setInterval(() => {
        _tickCount++;
        console.log(`[ProactivityEngine] ── Heartbeat #${_tickCount} (interval=${_intervalMs / 1000}s, level=${_level}) ──`);
        evaluateProactivity().catch(e => console.error('[ProactivityEngine] Loop error:', e));
    }, _intervalMs);
    console.log(`[ProactivityEngine] Loop restarted (interval: ${_intervalMs / 1000}s)`);
}

/* ── Test helpers ── */
export function _getLastProactiveAt(): number { return _lastProactiveAt; }
export function _setLastProactiveAt(ts: number): void { _lastProactiveAt = ts; }
export function _resetEngine(): void {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _lastProactiveAt = 0; _db = null; _mainWindow = null;
    _lastEvalResult = null; _lastEvalAt = null;
    _cooldownMs = DEFAULT_COOLDOWN_MS;
    _intervalMs = DEFAULT_INTERVAL_BY_LEVEL.MEDIUM;
    _level = 'MEDIUM';
    _customCooldowns = {};
    _customIntervals = {};
    _tickCount = 0;
}

/* ── Cognitive Filter System Prompts (per level) ── */
const PROMPT_FOOTER = `\n\nYour response MUST be a valid JSON object:
{"should_speak": boolean, "message": "Your natural message here in the user's language", "reason": "Brief reason"}
If should_speak is false, set message to "" and reason to your reasoning.`;

const PROMPTS_BY_LEVEL: Record<Exclude<ProactivityLevel, 'OFF'>, string> = {
    LOW: `You are the subconscious of RedBus, a local desktop AI assistant. The user configured proactivity to LOW.
You MUST ONLY interrupt if there is a SEVERE technical error, a critical business failure visible on screen, or something of extreme urgency.
Otherwise, your response for should_speak MUST be false. Be extremely conservative.` + PROMPT_FOOTER,

    MEDIUM: `You are the subconscious of RedBus, a local desktop AI assistant. Proactivity level: MEDIUM.
Interrupt if you can offer a useful summary of a long text, alert about an error, suggest an obvious automation for what's on screen, or provide a genuinely helpful insight.
DO NOT speak for mundane activities, entertainment, or when you would just state the obvious.
Keep messages concise and actionable.` + PROMPT_FOOTER,

    HIGH: `You are the subconscious of RedBus, a local desktop AI assistant. Proactivity level: HIGH.
You should be proactive and inferential. Observe the screen context and make pertinent comments, suggest ideas, point out curiosities, or offer help for practically any activity the user is doing, as long as it adds some value.
Be present. When in doubt, prefer to speak. A helpful suggestion that the user ignores is better than silence when the user needed help.` + PROMPT_FOOTER,
};

function getPromptForLevel(force?: boolean): string {
    if (_level === 'OFF') return force ? PROMPTS_BY_LEVEL.HIGH : '';
    return PROMPTS_BY_LEVEL[_level];
}

/* ── JSON Parser ── */
function parseDecision(raw: string): { should_speak: boolean; message: string; reason: string } | null {
    try {
        const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        return { should_speak: !!parsed.should_speak, message: parsed.message || '', reason: parsed.reason || '' };
    } catch {
        console.warn('[ProactivityEngine] Failed to parse LLM decision JSON');
        return null;
    }
}

/* ── LLM Call (Utility role, 30s timeout) ── */
async function callCognitiveFilter(db: any, sysPrompt: string, userPrompt: string): Promise<string> {
    const result = await chatWithRole(db, 'utility', {
        systemPrompt: sysPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        responseFormat: 'json_object',
        maxTokens: 512,
    });
    return result.content || '';
}

/* ── Core Evaluation ── */
export async function evaluateProactivity(options?: { force?: boolean }): Promise<{ spoke: boolean; reason?: string }> {
    const force = options?.force ?? false;
    const evalTs = new Date().toISOString();
    console.log(`[ProactivityEngine] ── Tick @ ${evalTs} (level=${_level}, force=${force}, agentState=${getAgentState()}) ──`);

    function earlyReturn(reason: string) {
        console.log(`[ProactivityEngine] Skip: ${reason}`);
        const result = { spoke: false, reason };
        _lastEvalResult = result;
        _lastEvalAt = new Date().toISOString();
        return result;
    }

    if (!force && _level === 'OFF') return earlyReturn('OFF');
    if (getAgentState() === 'BUSY') return earlyReturn('BUSY');
    if (!force && Date.now() - _lastProactiveAt < _cooldownMs) {
        const remaining = Math.round((_cooldownMs - (Date.now() - _lastProactiveAt)) / 1000);
        return earlyReturn(`COOLDOWN (${remaining}s remaining)`);
    }

    if (force) console.log('[ProactivityEngine] ⚡ Forced evaluation (bypassing cooldown/OFF)');

    const envCtx = getEnvironmentalContext();
    console.log(`[ProactivityEngine] Environmental context: activeWindow=${!!envCtx.activeWindow}, clipboard=${!!envCtx.clipboardText}`);

    const parts: string[] = [];
    if (envCtx.activeWindow) parts.push(`Active Window: ${envCtx.activeWindow.appName} — ${envCtx.activeWindow.title || '(no title)'}`);
    if (envCtx.clipboardText) parts.push(`Clipboard: ${envCtx.clipboardText.slice(0, 500)}`);
    if (_db) {
        try {
            const rows = _db.prepare(
                `SELECT extracted_text, active_app FROM ScreenMemory WHERE timestamp > datetime('now', '-5 minutes') ORDER BY timestamp DESC LIMIT 3`
            ).all();
            for (const r of rows) parts.push(`Screen OCR (${r.active_app || 'unknown'}): ${(r.extracted_text || '').slice(0, 300)}`);
            if (rows.length > 0) console.log(`[ProactivityEngine] ScreenMemory: ${rows.length} recent entries`);
        } catch { /* table may not exist */ }
    }
    // ── Pending To-Dos with approaching/overdue deadlines ──
    if (_db) {
        try {
            const { getPendingTodosWithDeadline } = require('./todoService');
            const urgentTodos = getPendingTodosWithDeadline(_db, 2 * 60 * 60 * 1000); // within 2 hours
            if (urgentTodos.length > 0) {
                const now = new Date();
                const todoLines = urgentTodos.map((t: any) => {
                    const due = new Date(t.target_date);
                    const diffMs = due.getTime() - now.getTime();
                    const label = diffMs < 0 ? `VENCIDO há ${Math.round(-diffMs / 60000)} min` : `vence em ${Math.round(diffMs / 60000)} min`;
                    return `• "${t.content}" — ${label}`;
                });
                parts.push(`⚠️ TAREFAS PENDENTES COM PRAZO PRÓXIMO:\n${todoLines.join('\n')}\nSugira ao usuário como resolver essas tarefas, levando em conta o que ele está fazendo agora (janela ativa, clipboard).`);
            }
        } catch { /* todoService may not be available */ }
    }

    if (parts.length === 0 && !force) return earlyReturn('NO_CONTEXT');
    if (parts.length === 0 && force) parts.push('(No environmental context available — sensors may be off. Respond with a brief, friendly check-in message.)');
    if (!_db) return earlyReturn('NO_DB');

    const configs = _db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
    if (!configs) return earlyReturn('NO_CONFIGS');

    const utilityBinding = resolveRole(_db, 'utility');
    const model = utilityBinding.model;
    const isOllama = model.startsWith('ollama/') || model.startsWith('ollama-cloud/');
    const hasKey = isOllama || (model.includes('gemini') && configs.googleKey) || (model.includes('claude') && configs.anthropicKey) || ((model.includes('gpt') || model.includes('o1') || model.includes('o3')) && configs.openAiKey);
    if (!hasKey) return earlyReturn(`NO_API_KEY for model ${model}`);

    console.log(`[ProactivityEngine] Evaluating with ${parts.length} context parts via ${model}...`);

    try {
        const raw = await callCognitiveFilter(
            _db, getPromptForLevel(force),
            `Current environmental context:\n${parts.join('\n')}`
        );
        console.log(`[ProactivityEngine] LLM raw response: ${raw.slice(0, 200)}`);

        const decision = parseDecision(raw);
        console.log(`[ProactivityEngine] Decision: should_speak=${decision?.should_speak}, reason=${decision?.reason}`);

        if (!decision || !decision.should_speak || !decision.message) {
            return earlyReturn(decision?.reason || 'LLM_SILENT');
        }

        setAgentState('BUSY');
        try {
            _lastProactiveAt = Date.now();
            const msgId = uuidv4();
            console.log(`[ProactivityEngine] Saving message ${msgId} to DB...`);
            saveMessage(_db, { id: msgId, role: 'assistant', content: decision.message, type: 'proactive' });

            if (_mainWindow && !_mainWindow.isDestroyed()) {
                console.log(`[ProactivityEngine] Sending chat:new-message to renderer (mainWindow exists, not destroyed)`);
                _mainWindow.webContents.send('chat:new-message', {
                    id: msgId, role: 'assistant', content: decision.message, type: 'proactive',
                });
            } else {
                console.warn(`[ProactivityEngine] mainWindow missing or destroyed — cannot send to renderer`);
            }
            sendOSNotification('RedBus', decision.message.slice(0, 120));
            logActivity('proactivity', `Sugestão proativa gerada: "${decision.message.slice(0, 80)}…"`);
        } finally {
            setAgentState('IDLE');
        }
        const result = { spoke: true, reason: decision.reason };
        _lastEvalResult = result;
        _lastEvalAt = new Date().toISOString();
        console.log(`[ProactivityEngine] ✅ Spoke: "${decision.message.slice(0, 80)}..." (reason: ${decision.reason})`);
        return result;
    } catch (err) {
        console.error('[ProactivityEngine] Evaluation failed:', err);
        return earlyReturn('ERROR');
    }
}


/* ── Lifecycle ── */
export function startProactivityEngine(db: any, mainWindow: BrowserWindow, cooldownMs?: number): void {
    if (_timer) return;
    _db = db;
    _mainWindow = mainWindow;

    // Restore persisted custom timings from DB
    if (db) {
        try {
            for (const lvl of ['OFF', 'LOW', 'MEDIUM', 'HIGH'] as ProactivityLevel[]) {
                const savedInterval = getAppSetting(db, `proactivity_interval_${lvl}`);
                if (savedInterval) _customIntervals[lvl] = Number(savedInterval);
                const savedCooldown = getAppSetting(db, `proactivity_cooldown_${lvl}`);
                if (savedCooldown) _customCooldowns[lvl] = Number(savedCooldown);
            }
        } catch { /* DB may not be ready */ }
    }

    // Restore persisted level from DB (must come after timings restoration)
    if (db) {
        try {
            const saved = getAppSetting(db, 'proactivity_level');
            if (saved && ['OFF', 'LOW', 'MEDIUM', 'HIGH'].includes(saved)) {
                setProactivityLevel(saved as ProactivityLevel);
            }
        } catch { /* DB may not be ready */ }
    }

    // Allow explicit cooldown override (used in tests)
    if (cooldownMs !== undefined) _cooldownMs = cooldownMs;

    // Startup diagnostics
    const sensorStates = getSensorStatuses();
    const envCtx = getEnvironmentalContext();
    console.log(`[ProactivityEngine] Startup diagnostics:`);
    console.log(`  mainWindow: ${_mainWindow ? 'SET' : 'NULL'}, destroyed: ${_mainWindow?.isDestroyed?.() ?? 'N/A'}`);
    console.log(`  db: ${_db ? 'SET' : 'NULL'}`);
    console.log(`  sensors: ${sensorStates.map(s => `${s.id}=${s.enabled}`).join(', ')}`);
    console.log(`  envContext: activeWindow=${!!envCtx.activeWindow}, clipboard=${!!envCtx.clipboardText}`);
    try {
        const configs = _db?.prepare?.('SELECT googleKey, anthropicKey, openAiKey FROM ProviderConfigs WHERE id = 1').get();
        if (configs) {
            const model = resolveRole(_db, 'utility').model;
            const isOllama = model.startsWith('ollama/') || model.startsWith('ollama-cloud/');
            const hasKey = isOllama || (model.includes('gemini') && !!configs.googleKey) || (model.includes('claude') && !!configs.anthropicKey) || ((model.includes('gpt') || model.includes('o1') || model.includes('o3')) && !!configs.openAiKey);
            console.log(`  utility role model: ${model}, hasSupport: ${hasKey}`);
        } else {
            console.log(`  ProviderConfigs: NOT FOUND`);
        }
    } catch { console.log(`  ProviderConfigs: ERROR reading`); }

    _tickCount = 0;
    _timer = setInterval(() => {
        _tickCount++;
        console.log(`[ProactivityEngine] ── Heartbeat #${_tickCount} (interval=${_intervalMs / 1000}s, level=${_level}) ──`);
        evaluateProactivity().catch(e => console.error('[ProactivityEngine] Loop error:', e));
    }, _intervalMs);
    console.log(`[ProactivityEngine] Started (level: ${_level}, interval: ${_intervalMs / 1000}s, cooldown: ${_cooldownMs / 1000}s)`);
}

export function stopProactivityEngine(): void {
    if (_timer) { clearInterval(_timer); _timer = null; }
    console.log('[ProactivityEngine] Stopped');
}