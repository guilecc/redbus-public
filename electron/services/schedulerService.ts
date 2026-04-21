import { v4 as uuidv4 } from 'uuid';
import { logActivity } from './activityLogger';
import { saveMessage } from './archiveService';
import { saveFactFromRoutine } from './memoryService';
import { notifyRoutineSuccess, notifyRoutineError } from './notificationService';
import type Database from 'better-sqlite3';
const cronParser = require('cron-parser');
import { createHiddenBrowserView } from '../browserManager';
import { extractDataFromDOM } from './llmService';
import { BrowserWindow } from 'electron';
import { synthesizeTaskResponse } from './orchestratorService';
import { executeSkillTask } from './workerLoop';

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
          // ── Digest Action (FORMAT P — auto-generated digest) ──
          if (specBody.digest_action) {
            const today = new Date().toISOString().slice(0, 10);
            const startOfDay = new Date(`${today}T00:00:00`);
            const endOfDay = new Date(startOfDay.getTime() + 24 * 3600 * 1000);
            const since = startOfDay.toISOString();
            const until = endOfDay.toISOString();

            try {
              const { fetchMessagesInRange } = await import('./graph/graphMailService');
              const { fetchChatMessagesInRange } = await import('./graph/graphTeamsService');
              await Promise.allSettled([fetchMessagesInRange(db, since, until), fetchChatMessagesInRange(db, since, until)]);
            } catch { /* best-effort */ }

            const { listCommunications, getCommunicationsByIds } = await import('./communicationsStore');
            const { generateDigestFromMessages, saveDigest, cleanPreview, curateDigestMessages, DEFAULT_DIGEST_CURATION } = await import('./digestService');
            const { getAppSetting } = await import('../database');
            const { callRoleRaw } = await import('./llmService');
            const { resolveRole, SetupRequiredError } = await import('./roles');

            let allItems = listCommunications(db, { since, until, limit: 5000 });
            const fPreset: string | null = specBody.filter_preset_name || null;
            if (fPreset) {
              const presetsRaw = getAppSetting(db, 'comms.filter_presets');
              const presets: any[] = presetsRaw ? JSON.parse(presetsRaw) : [];
              const preset = presets.find((p: any) => p.name === fPreset || p.id === fPreset);
              if (preset) {
                const bl = (preset.blacklist || []).map((s: string) => s.toLowerCase().trim());
                const wl = (preset.whitelist || []).map((s: string) => s.toLowerCase().trim());
                const src = preset.sources || { outlook: true, teams: true };
                allItems = allItems.filter(item => {
                  if (!src[item.source]) return false;
                  if (preset.unreadOnly && !item.isUnread) return false;
                  const st = `${item.sender || ''} ${item.senderEmail || ''} ${item.channelOrChatName || ''}`.toLowerCase();
                  if (wl.length > 0 && !wl.some((w: string) => st.includes(w))) return false;
                  if (bl.length > 0 && bl.some((b: string) => st.includes(b))) return false;
                  return true;
                });
              }
            }

            if (allItems.length === 0) {
              const endedAt = new Date().toISOString();
              const durationMs = Date.now() - startMs;
              recordExecution(db, row.id, startedAt, endedAt, 'skipped', undefined, 'Sem mensagens para o dia', durationMs);
              db.prepare('UPDATE LivingSpecs SET last_duration_ms = ?, next_run_at = ? WHERE id = ?')
                .run(durationMs, computeNextRun(row.cron_expression, row.timezone), row.id);
              notifyRoutineSuccess(goal, 'Sem mensagens para gerar digest hoje.');
            } else {
              const curationRaw = getAppSetting(db, 'comms.digest.curation');
              let curationCfg = DEFAULT_DIGEST_CURATION;
              if (curationRaw) { try { curationCfg = { ...DEFAULT_DIGEST_CURATION, ...JSON.parse(curationRaw) }; } catch { } }
              const rawItems = getCommunicationsByIds(db, allItems.map(i => i.id));
              const curated = curateDigestMessages(rawItems, curationCfg);
              const messages = curated.map(i => ({
                channel: i.source, sender: i.sender, subject: i.subject,
                preview: cleanPreview(i.plainText || '', i.source),
                timestamp: i.timestamp, isUnread: i.isUnread,
                importance: i.importance, mentionsMe: i.mentionsMe,
              }));
              const resolveDigestRole = () => {
                for (const c of ['digest', 'utility', 'executor'] as const) {
                  try { resolveRole(db, c); return c; } catch (e) { if (!(e instanceof SetupRequiredError)) throw e; }
                }
                throw new SetupRequiredError('digest');
              };
              const role = resolveDigestRole();
              const callLLM = async (prompt: string) => callRoleRaw(db, role, 'Você é um assistente executivo. Retorne APENAS JSON válido sem markdown.', prompt);
              let userContext: any;
              try {
                const profileRow = db.prepare(`SELECT professional_name, professional_email, professional_aliases FROM UserProfile WHERE id = 'default'`).get() as any;
                const aliases = profileRow?.professional_aliases ? JSON.parse(profileRow.professional_aliases) : [];
                if (profileRow?.professional_name || profileRow?.professional_email || aliases.length > 0) {
                  userContext = { professional_name: profileRow?.professional_name, professional_email: profileRow?.professional_email, professional_aliases: aliases };
                }
              } catch { }
              const summary = await generateDigestFromMessages(messages, callLLM, userContext);
              db.prepare('DELETE FROM CommunicationDigest WHERE digest_date = ?').run(today);
              const digestId = saveDigest(db, today, 'all', summary, messages);
              const endedAt = new Date().toISOString();
              const durationMs = Date.now() - startMs;
              const replyText = `[cron: ${goal}] Digest de ${today} gerado: ${summary.total_messages} mensagens, ${summary.topics?.length || 0} tópicos.`;
              const replyId = uuidv4();
              saveMessage(db, { id: replyId, role: 'assistant', content: replyText });
              mainWindow.webContents.send('worker:step-updated', { specId: row.id, stepIndex: 0, status: 'completed', data: JSON.stringify({ date: today, digestId }), conversationalReply: replyText, replyId });
              mainWindow.webContents.send('digest:complete', { date: today, id: digestId, summary });
              db.prepare('UPDATE LivingSpecs SET consecutive_errors = 0, last_error = NULL, last_duration_ms = ?, next_run_at = ? WHERE id = ?')
                .run(durationMs, computeNextRun(row.cron_expression, row.timezone), row.id);
              recordExecution(db, row.id, startedAt, endedAt, 'ok', undefined, replyText.slice(0, 200), durationMs);
              if (replyText) saveFactFromRoutine(db, goal, replyText.slice(0, 200));
              notifyRoutineSuccess(goal, replyText.slice(0, 100));
            }
          }
          // ── Skill Task Execution (ReAct via exec/read_file) ──
          else if (specBody.use_skill || specBody.task) {
            const task: string = specBody.task || specBody.goal || '';
            const skillName: string | undefined = specBody.use_skill || undefined;

            const result = await executeSkillTask(db, { task, skillName }, mainWindow);
            const rendered = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            const endedAt = new Date().toISOString();
            const durationMs = Date.now() - startMs;

            const reply = await synthesizeTaskResponse(db, goal, rendered);
            const replyId = uuidv4();
            saveMessage(db, { id: replyId, role: 'assistant', content: `[cron: ${goal}] ${reply}` });
            mainWindow.webContents.send('worker:step-updated', {
              specId: row.id, stepIndex: 0, status: 'completed',
              data: rendered, conversationalReply: `[cron: ${goal}] ${reply}`, replyId,
            });
            db.prepare(`
              UPDATE LivingSpecs SET consecutive_errors = 0, last_error = NULL, last_duration_ms = ?, next_run_at = ?
              WHERE id = ?
            `).run(durationMs, computeNextRun(row.cron_expression, row.timezone), row.id);
            recordExecution(db, row.id, startedAt, endedAt, 'ok', undefined, reply?.slice(0, 200), durationMs);
            if (reply) saveFactFromRoutine(db, goal, reply.slice(0, 200));

            notifyRoutineSuccess(goal, reply?.slice(0, 100));
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
    if (specBody.use_skill || specBody.task) {
      const task: string = specBody.task || specBody.goal || '';
      const skillName: string | undefined = specBody.use_skill || undefined;

      const result = await executeSkillTask(db, { task, skillName }, mainWindow);
      const rendered = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      const reply = await synthesizeTaskResponse(db, goal, rendered);
      const replyId = uuidv4();
      saveMessage(db, { id: replyId, role: 'assistant', content: `[manual: ${goal}] ${reply}` });
      mainWindow.webContents.send('worker:step-updated', {
        specId: row.id, stepIndex: 0, status: 'completed',
        data: rendered, conversationalReply: `[manual: ${goal}] ${reply}`, replyId,
      });
      db.prepare(`
        UPDATE LivingSpecs SET consecutive_errors = 0, last_error = NULL, last_duration_ms = ?, next_run_at = ?
        WHERE id = ?
      `).run(durationMs, row.cron_expression ? computeNextRun(row.cron_expression, row.timezone) : null, row.id);
      recordExecution(db, row.id, startedAt, endedAt, 'ok', undefined, reply?.slice(0, 200), durationMs);
      return { status: 'ok', summary: reply?.slice(0, 200) };
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
