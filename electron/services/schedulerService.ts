import type Database from 'better-sqlite3';
const cronParser = require('cron-parser');
import { createHiddenBrowserView } from '../browserManager';
import { extractDataFromDOM } from './llmService';
import { BrowserWindow } from 'electron';
import { executePython } from './pythonExecutor';
import { synthesizeTaskResponse } from './orchestratorService';
import { saveMessage } from './archiveService';
import { readSnippet } from './forgeService';
import { saveFactFromRoutine } from './memoryService';
import { notifyRoutineSuccess, notifyRoutineError } from './notificationService';
import { v4 as uuidv4 } from 'uuid';
import { logActivity } from './activityLogger';

/* ── Backoff schedule (ms) indexed by consecutive error count ── */
const BACKOFF_SCHEDULE_MS = [
  30_000,       // 1st error  →  30 s
  60_000,       // 2nd error  →   1 min
  5 * 60_000,   // 3rd error  →   5 min
  15 * 60_000,  // 4th error  →  15 min
  60 * 60_000,  // 5th+ error →  60 min
];

function errorBackoffMs(consecutiveErrors: number): number {
  const idx = Math.min(Math.max(0, consecutiveErrors - 1), BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[idx];
}

/* ── Compute next run ISO from a cron expression ── */
export function computeNextRun(cronExpression: string, tz?: string): string | null {
  try {
    const opts: any = { tz: tz || Intl.DateTimeFormat().resolvedOptions().timeZone };
    const interval = cronParser.parseExpression(cronExpression, opts);
    return interval.next().toDate().toISOString();
  } catch {
    return null;
  }
}

/* ── Record a routine execution in RoutineExecutions ── */
function recordExecution(
  db: any, specId: string, startedAt: string, endedAt: string,
  status: 'ok' | 'error' | 'skipped', error?: string, summary?: string, durationMs?: number,
) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO RoutineExecutions (id, specId, startedAt, endedAt, status, error, summary, durationMs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, specId, startedAt, endedAt, status, error || null, summary?.slice(0, 500) || null, durationMs || null);
}

/* ── Check if a spec is due for execution ── */
function isDue(row: any, now: Date): boolean {
  // Respect enabled flag
  if (row.enabled === 0) return false;

  try {
    const interval = cronParser.parseExpression(row.cron_expression, { currentDate: now });
    const prevRun = interval.prev().toDate();

    const isThisMinute =
      prevRun.getMinutes() === now.getMinutes() &&
      prevRun.getHours() === now.getHours() &&
      prevRun.getDate() === now.getDate();

    if (!isThisMinute) return false;

    // Already ran this minute?
    if (row.last_run) {
      const lastRunDate = new Date(row.last_run);
      if (
        lastRunDate.getMinutes() === now.getMinutes() &&
        lastRunDate.getHours() === now.getHours() &&
        lastRunDate.getDate() === now.getDate()
      ) return false;
    }

    // Backoff: if there are consecutive errors, check if we're still in the backoff window
    const consecutiveErrors = row.consecutive_errors || 0;
    if (consecutiveErrors > 0 && row.last_run) {
      const lastRunMs = new Date(row.last_run).getTime();
      const backoff = errorBackoffMs(consecutiveErrors);
      if (now.getTime() < lastRunMs + backoff) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/* ── Main scheduler loop ── */
export function startScheduler(db: ReturnType<typeof Database> | any, mainWindow: BrowserWindow | null) {
  // On startup: compute next_run_at for all active crons
  try {
    const activeSpecs = db.prepare(
      `SELECT id, cron_expression, timezone FROM LivingSpecs WHERE status = 'ACTIVE' AND cron_expression IS NOT NULL`
    ).all();
    for (const row of activeSpecs) {
      const nextRun = computeNextRun(row.cron_expression, row.timezone);
      if (nextRun) {
        db.prepare('UPDATE LivingSpecs SET next_run_at = ? WHERE id = ?').run(nextRun, row.id);
      }
    }
  } catch (e) {
    console.error('[Scheduler] Failed to compute initial next_run_at:', e);
  }

  // Poll every 60 seconds
  setInterval(async () => {
    if (!mainWindow) return;

    try {
      const now = new Date();
      const activeSpecs = db.prepare(
        `SELECT * FROM LivingSpecs WHERE status = 'ACTIVE' AND cron_expression IS NOT NULL`
      ).all();

      for (const row of activeSpecs) {
        if (!isDue(row, now)) continue;

        const startedAt = new Date().toISOString();
        const startMs = Date.now();
        const specBody = JSON.parse(row.specJson);
        const goal = specBody.goal || '';

        console.log(`[Scheduler] Cron Triggered: ${row.id} — ${goal}`);
        logActivity('routines', `Rotina disparada: ${goal}`, { specId: row.id });

        // Update last_run immediately
        db.prepare('UPDATE LivingSpecs SET last_run = ? WHERE id = ?').run(startedAt, row.id);

        try {
          // ── Skill or Python Script Execution ──
          if (specBody.skill_name || specBody.python_script) {
            let scriptCode = specBody.python_script;
            let vaultKeys = specBody.required_vault_keys || [];
            const skillArgs = specBody.skill_args || {};

            if (specBody.skill_name) {
              const skill = readSnippet(db, specBody.skill_name);
              if (!skill) throw new Error(`Skill "${specBody.skill_name}" not found`);
              scriptCode = skill.code;
              vaultKeys = JSON.parse(skill.required_vault_keys || '[]');
            }

            const pyResult = await executePython(db, scriptCode, vaultKeys, skillArgs);
            const endedAt = new Date().toISOString();
            const durationMs = Date.now() - startMs;

            if (pyResult.exitCode === 0 && pyResult.stdout.trim()) {
              const reply = await synthesizeTaskResponse(db, goal, pyResult.stdout);
              const replyId = uuidv4();
              saveMessage(db, { id: replyId, role: 'assistant', content: `[cron: ${goal}] ${reply}` });
              mainWindow.webContents.send('worker:step-updated', {
                specId: row.id, stepIndex: 0, status: 'completed',
                data: pyResult.stdout, conversationalReply: `[cron: ${goal}] ${reply}`, replyId,
              });
              // Success: reset errors, record execution
              db.prepare(`
                UPDATE LivingSpecs SET consecutive_errors = 0, last_error = NULL, last_duration_ms = ?, next_run_at = ?
                WHERE id = ?
              `).run(durationMs, computeNextRun(row.cron_expression, row.timezone), row.id);
              recordExecution(db, row.id, startedAt, endedAt, 'ok', undefined, reply?.slice(0, 200), durationMs);
              if (reply) saveFactFromRoutine(db, goal, reply.slice(0, 200));

              notifyRoutineSuccess(goal, reply?.slice(0, 100));
            } else {
              throw new Error(pyResult.stderr || 'Python script returned non-zero exit code');
            }
          }
          // ── Browser Automation ──
          else if (specBody.steps && specBody.steps.length > 0) {
            let lastExtraction = '';
            for (const step of specBody.steps) {
              const domResult = await createHiddenBrowserView(mainWindow, step.url);
              lastExtraction = await extractDataFromDOM(db, domResult.text, step.instruction);
            }
            const endedAt = new Date().toISOString();
            const durationMs = Date.now() - startMs;

            if (lastExtraction) {
              const reply = await synthesizeTaskResponse(db, goal, lastExtraction);
              const replyId = uuidv4();
              saveMessage(db, { id: replyId, role: 'assistant', content: `[cron: ${goal}] ${reply}` });
              mainWindow.webContents.send('worker:step-updated', {
                specId: row.id, stepIndex: 0, status: 'completed',
                data: lastExtraction, conversationalReply: `[cron: ${goal}] ${reply}`, replyId,
              });
              db.prepare(`
                UPDATE LivingSpecs SET consecutive_errors = 0, last_error = NULL, last_duration_ms = ?, next_run_at = ?
                WHERE id = ?
              `).run(durationMs, computeNextRun(row.cron_expression, row.timezone), row.id);
              recordExecution(db, row.id, startedAt, endedAt, 'ok', undefined, reply?.slice(0, 200), durationMs);
              if (reply) saveFactFromRoutine(db, goal, reply.slice(0, 200));

              notifyRoutineSuccess(goal, reply?.slice(0, 100));
            }
          }
        } catch (err: any) {
          const errorText = String(err?.message || err).slice(0, 500);
          const endedAt = new Date().toISOString();
          const durationMs = Date.now() - startMs;
          const newErrors = (row.consecutive_errors || 0) + 1;

          console.error(`[Scheduler] Error for Spec ${row.id}:`, errorText);
          logActivity('routines', `Rotina falhou: ${goal} — ${errorText.slice(0, 80)}`, { specId: row.id, durationMs }, true);

          db.prepare(`
            UPDATE LivingSpecs SET consecutive_errors = ?, last_error = ?, last_duration_ms = ?, next_run_at = ?
            WHERE id = ?
          `).run(newErrors, errorText, durationMs, computeNextRun(row.cron_expression, row.timezone), row.id);
          recordExecution(db, row.id, startedAt, endedAt, 'error', errorText, undefined, durationMs);

          notifyRoutineError(goal, errorText.slice(0, 80));
        }
      }
    } catch (e) {
      console.error('[Scheduler] Error checking DB:', e);
    }
  }, 60_000);
}

/* ── Manual trigger: execute a routine immediately ── */
export async function runRoutineNow(
  db: any, mainWindow: BrowserWindow | null, specId: string,
): Promise<{ status: 'ok' | 'error'; summary?: string; error?: string }> {
  if (!mainWindow) return { status: 'error', error: 'No main window' };

  const row = db.prepare('SELECT * FROM LivingSpecs WHERE id = ?').get(specId);
  if (!row) return { status: 'error', error: 'Routine not found' };

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const specBody = JSON.parse(row.specJson);
  const goal = specBody.goal || '';

  db.prepare('UPDATE LivingSpecs SET last_run = ? WHERE id = ?').run(startedAt, row.id);

  try {
    if (specBody.skill_name || specBody.python_script) {
      let scriptCode = specBody.python_script;
      let vaultKeys = specBody.required_vault_keys || [];
      const skillArgs = specBody.skill_args || {};

      if (specBody.skill_name) {
        const skill = readSnippet(db, specBody.skill_name);
        if (!skill) throw new Error(`Skill "${specBody.skill_name}" not found`);
        scriptCode = skill.code;
        vaultKeys = JSON.parse(skill.required_vault_keys || '[]');
      }

      const pyResult = await executePython(db, scriptCode, vaultKeys, skillArgs);
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      if (pyResult.exitCode === 0 && pyResult.stdout.trim()) {
        const reply = await synthesizeTaskResponse(db, goal, pyResult.stdout);
        const replyId = uuidv4();
        saveMessage(db, { id: replyId, role: 'assistant', content: `[manual: ${goal}] ${reply}` });
        mainWindow.webContents.send('worker:step-updated', {
          specId: row.id, stepIndex: 0, status: 'completed',
          data: pyResult.stdout, conversationalReply: `[manual: ${goal}] ${reply}`, replyId,
        });
        db.prepare(`
          UPDATE LivingSpecs SET consecutive_errors = 0, last_error = NULL, last_duration_ms = ?, next_run_at = ?
          WHERE id = ?
        `).run(durationMs, row.cron_expression ? computeNextRun(row.cron_expression, row.timezone) : null, row.id);
        recordExecution(db, row.id, startedAt, endedAt, 'ok', undefined, reply?.slice(0, 200), durationMs);
        return { status: 'ok', summary: reply?.slice(0, 200) };
      } else {
        throw new Error(pyResult.stderr || 'Non-zero exit code');
      }
    }

    if (specBody.steps && specBody.steps.length > 0) {
      let lastExtraction = '';
      for (const step of specBody.steps) {
        const domResult = await createHiddenBrowserView(mainWindow, step.url);
        lastExtraction = await extractDataFromDOM(db, domResult.text, step.instruction);
      }
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;
      const reply = await synthesizeTaskResponse(db, goal, lastExtraction);
      const replyId = uuidv4();
      saveMessage(db, { id: replyId, role: 'assistant', content: `[manual: ${goal}] ${reply}` });
      mainWindow.webContents.send('worker:step-updated', {
        specId: row.id, stepIndex: 0, status: 'completed',
        data: lastExtraction, conversationalReply: `[manual: ${goal}] ${reply}`, replyId,
      });
      db.prepare(`
        UPDATE LivingSpecs SET consecutive_errors = 0, last_error = NULL, last_duration_ms = ?, next_run_at = ?
        WHERE id = ?
      `).run(durationMs, row.cron_expression ? computeNextRun(row.cron_expression, row.timezone) : null, row.id);
      recordExecution(db, row.id, startedAt, endedAt, 'ok', undefined, reply?.slice(0, 200), durationMs);
      return { status: 'ok', summary: reply?.slice(0, 200) };
    }

    return { status: 'error', error: 'No executable payload in spec' };
  } catch (err: any) {
    const errorText = String(err?.message || err).slice(0, 500);
    const endedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;
    const newErrors = (row.consecutive_errors || 0) + 1;

    db.prepare(`
      UPDATE LivingSpecs SET consecutive_errors = ?, last_error = ?, last_duration_ms = ?
      WHERE id = ?
    `).run(newErrors, errorText, durationMs, row.id);
    recordExecution(db, row.id, startedAt, endedAt, 'error', errorText, undefined, durationMs);
    return { status: 'error', error: errorText };
  }
}
