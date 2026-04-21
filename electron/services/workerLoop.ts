/**
 * WorkerLoop — thin adapters over `runAgent` (Spec 09, Phase 4).
 *
 * The ReAct engine now lives under `electron/services/agentRunner/`.
 * The two entrypoints kept here exist only so existing callers
 * (`ipcHandlers.ts`, `schedulerService.ts`) can migrate on their own pace.
 */
import type { BrowserWindow } from 'electron';
import { browseSnapshot } from './playwrightService';
import { readSkill, getSkillsRoot } from './skillsLoader';
import { runAgent, newRunId, resolveHumanConsent as _resolveHumanConsent } from './agentRunner';

/** Re-export so `ipcMain.handle('hitl:respond', ...)` keeps working. */
export const resolveHumanConsent = _resolveHumanConsent;

const SNAPSHOT_BYTES = 20000;

function unwrapResult(result: Awaited<ReturnType<typeof runAgent>>): any {
  if (result.meta.stopReason === 'committed') return result.committedData;
  if (result.meta.stopReason === 'text_final') return result.committedData ?? result.finalText ?? '';
  if (result.meta.aborted) throw new Error('Run aborted');
  const detail = result.meta.error?.message || result.meta.stopReason;
  throw new Error(`Agent run failed: ${detail}`);
}

export async function executeWorkerOnView(
  db: any,
  sessionId: string,
  instruction: string,
  mainWindow?: BrowserWindow,
): Promise<any> {
  const initialSnapshot = await browseSnapshot(sessionId);
  console.log(`[WorkerLoop] 🧠 Starting intelligent navigation: "${instruction.substring(0, 80)}..."`);

  const userPrompt = `You are an intelligent browser agent with full navigation capabilities.

Instruction: ${instruction}

Current page snapshot (accessibility tree):
${initialSnapshot.substring(0, SNAPSHOT_BYTES)}

SNAPSHOT FORMAT:
The snapshot is an accessibility tree. Interactive elements have [ref=eN] markers.
Use these refs with tools: browser_click(ref="e5"), browser_type(ref="e3", text="hello").

TOOLS:
- browser_snapshot / browser_click / browser_type / browser_press_key / browser_scroll_*
- commit_extracted_data(data): Submit your final result
- read_file(path): Read a file from the skills directory
- exec(command, cwd?, timeout_ms?): Run a shell command (30s timeout)
- request_explicit_human_consent: HITL checkpoint

Navigate intelligently: click links, fill forms, scroll to find content.
When you have the information needed, call commit_extracted_data with the result.
If the data is already visible, commit immediately — don't waste steps.`;

  const result = await runAgent(db, {
    runId: newRunId(),
    sessionId,
    role: 'executor',
    mode: { kind: 'browser', browserSessionId: sessionId },
    prompt: { user: userPrompt },
    mainWindow,
  });
  return unwrapResult(result);
}

export async function executeSkillTask(
  db: any,
  params: { task: string; skillName?: string },
  mainWindow?: BrowserWindow,
): Promise<any> {
  const { task, skillName } = params;
  const rec = skillName ? readSkill(skillName) : null;

  const header = rec
    ? `You are executing the Skill playbook "${rec.frontmatter.name}".

Skill location: ${rec.dir}
Description: ${rec.frontmatter.description}

--- SKILL.md (playbook) ---
${rec.body}
--- END SKILL.md ---`
    : `You are executing an ad-hoc task without a preloaded skill. Use \`exec\` and \`read_file\` to investigate and act.`;

  const envDeclared = rec?.frontmatter.metadata?.requires?.env || [];
  const envHint = envDeclared.length > 0
    ? `\nEnv vars injected into exec automatically: ${envDeclared.join(', ')}.`
    : '';

  const userPrompt = `${header}
${envHint}

USER TASK: ${task}

TOOLS:
- read_file(path): Read a file inside ${getSkillsRoot()} (the playbook, its references/, assets/, or scripts/).
- exec(command, cwd?, timeout_ms?): Run a shell command (/bin/sh -c). 30s timeout. ${rec ? `Defaults cwd to the skill dir.` : ''}
- request_explicit_human_consent(reason_for_consent, intended_action): Pause for approval when about to do something destructive.
- commit_extracted_data(data): Return the final result to the user.

STRATEGY:
1. Re-read SKILL.md via read_file if you need to inspect it again.
2. Follow the playbook steps using \`exec\`. Observe stderr; adjust and retry on errors.
3. When the task is complete, call commit_extracted_data with the structured result.
4. NEVER invent data. If a command fails, investigate and correct instead of fabricating output.`;

  const result = await runAgent(db, {
    runId: newRunId(),
    sessionId: `skill:${skillName || 'adhoc'}:${Date.now()}`,
    role: 'executor',
    mode: { kind: 'skill', skillName },
    prompt: { user: userPrompt },
    mainWindow,
  });
  return unwrapResult(result);
}

