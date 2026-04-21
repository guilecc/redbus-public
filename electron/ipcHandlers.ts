import { ipcMain, BrowserWindow, app, session } from 'electron';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { createHiddenBrowserView, showBrowserView, hideBrowserView, resumeViewExtraction, resolveAuth } from './browserManager';
import { extractDataFromDOM } from './services/llmService';
import { createSpecFromPrompt, synthesizeTaskResponse } from './services/orchestratorService';
import { executeWorkerOnView, executeSkillTask, resolveHumanConsent } from './services/workerLoop';
import { abortRun, listActiveRuns } from './services/agentRunner';
import { fetchAvailableModels } from './services/providerService';
import { saveMessage, getMessages, listArchiveFiles, deleteArchiveFile, archiveOldMessages } from './services/archiveService';
import { compactHistoryIfNeeded } from './services/memoryService';
import { factoryReset } from './database';
import { saveSecret, listSecrets, deleteSecret } from './services/vaultService';
import { listSkills, readSkill, writeSkill, deleteSkill } from './services/skillsLoader';
import { syncSpawnSubagentTool } from './plugins/subagent-tool';
import { checkOllamaStatus, listInstalledModels, pullModel } from './services/ollamaService';
import { runRoutineNow, computeNextRun } from './services/schedulerService';
import { searchMemory } from './services/memorySearchService';
import { getActiveFacts } from './services/memoryService';
import { parseRolesJson, serializeRolesJson, ROLE_NAMES, REQUIRED_ROLE_NAMES, resolveRole, SetupRequiredError, type RoleName, type RolesMap } from './services/roles';

import { notifyChatResponse, notifyManualRoutine, sendOSNotification, isAppFocused } from './services/notificationService';
import { toggleSensor, getSensorStatuses } from './services/sensorManager';
import { searchScreenMemory } from './services/screenMemoryService';
import { getProactivityStatus, setProactivityLevel, getLevelTimings, setLevelTiming } from './services/proactivityEngine';
import { readAccessibilityTree, flattenTreeToText } from './services/accessibilitySensor';
import { getAppSetting, setAppSetting, cleanupOldMemories } from './database';
import { processAudio, analyzeTranscriptFromText } from './services/audioAdapterService';
import { saveMeetingMemory, searchMeetingMemory, listMeetings, getMeetingDetails, getMeetingContextForPrompt, deleteMeeting, addManualMeeting, ManualMeetingPayload } from './services/meetingService';
import { getRecentLogs, clearLogBuffer } from './services/activityLogger';
import { generateDigestFromMessages, saveDigest, listDigests, getDigestDetails, getDigestByDate, deleteDigest, DigestMessage, cleanPreview, curateDigestMessages, DEFAULT_DIGEST_CURATION, DigestCurationConfig } from './services/digestService';
import { createTodo, listTodos, completeTodo, archiveTodo, unarchiveTodo, deleteTodo, getTodo, CreateTodoPayload } from './services/todoService';
import { getProviderForModel, listProviders } from './plugins/registry';
import { ALL_THINK_LEVELS } from './services/thinking';

/**
 * Reads professional identity for digest prompts. Prefers UserProfile columns
 * (populated on Graph connect via `_hydrateAccountInfo`); falls back to raw
 * Graph account AppSettings for installs that connected before auto-sync.
 */
function loadProfessionalIdentity(db: any): { professional_name?: string; professional_email?: string; professional_aliases?: string[] } | undefined {
  try {
    const row = db.prepare(
      `SELECT professional_name, professional_email, professional_aliases FROM UserProfile WHERE id = 'default'`
    ).get() as { professional_name?: string; professional_email?: string; professional_aliases?: string } | undefined;
    let aliases: string[] = [];
    if (row?.professional_aliases) {
      try {
        const parsed = JSON.parse(row.professional_aliases);
        if (Array.isArray(parsed)) aliases = parsed.filter((a: any) => typeof a === 'string' && a.trim().length > 0);
      } catch { /* legacy — ignore */ }
    }
    let name = row?.professional_name?.trim() || '';
    let email = row?.professional_email?.trim() || '';
    if (!name || !email) {
      const upn = getAppSetting(db, 'graph.account.upn') || '';
      const dn = getAppSetting(db, 'graph.account.displayName') || '';
      if (!name) name = dn.trim();
      if (!email) email = upn.trim();
    }
    if (!name && !email && aliases.length === 0) return undefined;
    return {
      professional_name: name || undefined,
      professional_email: email || undefined,
      professional_aliases: aliases.length > 0 ? aliases : undefined,
    };
  } catch { return undefined; }
}

export function setupIpcHandlers(db: ReturnType<typeof Database> | null | any, mainWindow: BrowserWindow | null) {
  // Comunicação segura via JSON estruturado
  ipcMain.handle('orchestrator:send-task', async (event, payload: string) => {
    try {
      const task = JSON.parse(payload);
      console.log('Recebida tarefa para processar:', task);
      return JSON.stringify({ status: 'ACK', taskId: task.id });
    } catch (e) {
      console.error(e);
      return JSON.stringify({ status: 'ERROR', error: String(e) });
    }
  });

  ipcMain.handle('monitor:get-status', async () => {
    return JSON.stringify({
      activeWorkers: 1,
      activeBrowserViews: 0,
    });
  });

  // Settings Endpoints refatorados para retornar diretamente objetos JS (clonáveis pelo Electron)
  ipcMain.handle('settings:get', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const row = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get() as any;
      if (row) {
        // Deserialize the `roles` JSON column into an object for the renderer.
        row.roles = parseRolesJson(row.roles);
      }
      return { status: 'OK', data: row };
    } catch (e) {
      console.error(e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('get-user-profile', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const row = db.prepare('SELECT * FROM UserProfile WHERE id = ?').get('default');
      return { status: 'OK', data: row || null };
    } catch (e) {
      console.error(e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('save-user-profile', async (event, profile: any) => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const stmt = db.prepare(`
        INSERT INTO UserProfile (id, name, role, preferences, system_prompt_compiled)
        VALUES ('default', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          role = excluded.role,
          preferences = excluded.preferences,
          system_prompt_compiled = excluded.system_prompt_compiled,
          updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(profile.name, profile.role, profile.preferences, profile.system_prompt_compiled);
      return { status: 'OK' };
    } catch (e) {
      console.error(e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  // Professional identity: used by digestService to detect messages addressed to the user.
  // `professional_aliases` is serialized as a JSON array of strings on disk and
  // exposed as `string[]` over IPC.
  ipcMain.handle('user-profile:get-professional', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const row = db.prepare(
        `SELECT professional_name, professional_email, professional_aliases FROM UserProfile WHERE id = ?`
      ).get('default') as { professional_name?: string; professional_email?: string; professional_aliases?: string } | undefined;
      let aliases: string[] = [];
      if (row?.professional_aliases) {
        try {
          const parsed = JSON.parse(row.professional_aliases);
          if (Array.isArray(parsed)) aliases = parsed.filter((a) => typeof a === 'string' && a.trim().length > 0);
        } catch { /* legacy empty string — ignore */ }
      }
      return {
        status: 'OK',
        data: {
          professional_name: row?.professional_name ?? '',
          professional_email: row?.professional_email ?? '',
          professional_aliases: aliases,
        },
      };
    } catch (e) {
      console.error(e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('user-profile:save-professional', async (_event, payload: { professional_name?: string; professional_email?: string; professional_aliases?: string[] }) => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const name = (payload?.professional_name ?? '').trim();
      const email = (payload?.professional_email ?? '').trim();
      const aliases = Array.isArray(payload?.professional_aliases)
        ? payload!.professional_aliases!
          .map((a) => (typeof a === 'string' ? a.trim() : ''))
          .filter((a) => a.length > 0)
        : [];
      const aliasesJson = JSON.stringify(aliases);
      const stmt = db.prepare(`
        INSERT INTO UserProfile (id, name, role, preferences, system_prompt_compiled, professional_name, professional_email, professional_aliases)
        VALUES ('default', COALESCE((SELECT name FROM UserProfile WHERE id='default'), ''),
                          COALESCE((SELECT role FROM UserProfile WHERE id='default'), ''),
                          COALESCE((SELECT preferences FROM UserProfile WHERE id='default'), ''),
                          COALESCE((SELECT system_prompt_compiled FROM UserProfile WHERE id='default'), ''),
                          ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          professional_name = excluded.professional_name,
          professional_email = excluded.professional_email,
          professional_aliases = excluded.professional_aliases,
          updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(name, email, aliasesJson);
      return { status: 'OK' };
    } catch (e) {
      console.error(e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('settings:save', async (event, payload: any) => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const { openAiKey, anthropicKey, googleKey, ollamaUrl, ollamaCloudKey, ollamaCloudUrl, roles } = payload;

      const rolesJson = roles ? serializeRolesJson(parseRolesJson(roles)) : null;

      const stmt = db.prepare(`
        UPDATE ProviderConfigs
        SET
          openAiKey = COALESCE(?, openAiKey),
          anthropicKey = COALESCE(?, anthropicKey),
          googleKey = COALESCE(?, googleKey),
          ollamaUrl = COALESCE(?, ollamaUrl),
          ollamaCloudKey = ?,
          ollamaCloudUrl = COALESCE(?, ollamaCloudUrl),
          roles = COALESCE(?, roles),
          updatedAt = CURRENT_TIMESTAMP
        WHERE id = 1
      `);

      stmt.run(openAiKey, anthropicKey, googleKey, ollamaUrl, ollamaCloudKey, ollamaCloudUrl, rolesJson);
      return { status: 'OK' };
    } catch (e) {
      console.error(e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('settings:save-provider', async (event, provider: string, apiKey: string, defaultModel?: string) => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      let query = '';
      if (provider === 'openai') {
        query = 'UPDATE ProviderConfigs SET openAiKey = ? WHERE id = 1';
      } else if (provider === 'anthropic') {
        query = 'UPDATE ProviderConfigs SET anthropicKey = ? WHERE id = 1';
      } else if (provider === 'google') {
        query = 'UPDATE ProviderConfigs SET googleKey = ? WHERE id = 1';
      } else {
        return { status: 'ERROR', error: 'Unknown provider' };
      }

      db.prepare(query).run(apiKey);

      if (defaultModel) {
        // Update the planner role's model (was maestroModel). Preserve the
        // rest of the roles map.
        const row = db.prepare('SELECT roles FROM ProviderConfigs WHERE id = 1').get() as any;
        const roles = parseRolesJson(row?.roles);
        roles.planner = { ...roles.planner, model: defaultModel };
        db.prepare('UPDATE ProviderConfigs SET roles = ? WHERE id = 1').run(serializeRolesJson(roles));
      }

      return { status: 'OK' };
    } catch (e) {
      console.error(e);
      return { status: 'ERROR', error: String(e) };
    }
  });
  ipcMain.handle('settings:fetch-models', async (event, provider: 'openai' | 'anthropic' | 'google' | 'ollama-cloud', apiKey: string, urlOverride?: string) => {
    try {
      let customUrl = urlOverride;
      if (!customUrl && provider === 'ollama-cloud' && db) {
        const row = db.prepare('SELECT ollamaCloudUrl FROM ProviderConfigs WHERE id = 1').get() as any;
        customUrl = row?.ollamaCloudUrl;
      }
      const models = await fetchAvailableModels(provider, apiKey, customUrl);
      return { status: 'OK', data: models };
    } catch (e) {
      console.error('Fetch Models Failed:', e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('ollama:status', async (event, url?: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const config = db.prepare('SELECT ollamaUrl FROM ProviderConfigs WHERE id = 1').get();
      const targetUrl = url || config?.ollamaUrl || 'http://localhost:11434';
      const isRunning = await checkOllamaStatus(targetUrl);
      return { status: 'OK', data: isRunning };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('ollama:list', async (event, url?: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const config = db.prepare('SELECT ollamaUrl FROM ProviderConfigs WHERE id = 1').get();
      const targetUrl = url || config?.ollamaUrl || 'http://localhost:11434';
      const models = await listInstalledModels(targetUrl);
      return { status: 'OK', data: models };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('ollama:pull', async (event, modelTag: string, url?: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const config = db.prepare('SELECT ollamaUrl FROM ProviderConfigs WHERE id = 1').get();
      const targetUrl = url || config?.ollamaUrl || 'http://localhost:11434';
      // Pull operation is detached so we don't block IPC
      pullModel(targetUrl, modelTag, mainWindow).catch(console.error);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('run-worker-test', async (event, url: string, instruction: string) => {
    try {
      if (!mainWindow) throw new Error('MainWindow not defined');
      if (!db) throw new Error('DB not initialized');

      // Passo 1: Cria BrowserView oculta / temporária e extrai DOM
      const domResult = await createHiddenBrowserView(mainWindow, url);

      // Passo 2: Envia o DOM extraído e o pedido para o LLM configurado (Worker via API keys no SQLite)
      const jsonResponse = await extractDataFromDOM(db, domResult.text, instruction);

      return { status: 'OK', data: jsonResponse };
    } catch (e) {
      console.error('Worker Test Failed:', e);
      return { status: 'ERROR', error: String(e) };
    }
  });
  ipcMain.handle('orchestrator:create-spec', async (event, prompt: string | any[], filePaths?: string[]) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const result = await createSpecFromPrompt(db, prompt, filePaths);
      // Include requestId so renderer can correlate streaming events
      const { getCurrentRequestId } = await import('./services/orchestratorService');
      return { status: 'OK', data: { ...result, requestId: getCurrentRequestId() } };
    } catch (e) {
      console.error('Maestro Creation Failed:', e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('dialog:select-files', async () => {
    try {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documentos e Imagens', extensions: ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'txt', 'md', 'png', 'jpg', 'jpeg', 'json'] }
        ]
      });
      return { status: 'OK', data: result.filePaths || [] };
    } catch (e) {
      console.error('Failed to select files:', e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('orchestrator:execute-spec', async (event, specId: string) => {
    try {
      if (!mainWindow) throw new Error('MainWindow not defined');
      if (!db) throw new Error('DB not initialized');

      const row = db.prepare('SELECT * FROM LivingSpecs WHERE id = ?').get(specId);
      if (!row) throw new Error('Spec not found');

      const parsedSpec = JSON.parse(row.specJson);
      db.prepare("UPDATE LivingSpecs SET status = 'ACTIVE' WHERE id = ?").run(specId);

      if (parsedSpec.steps && parsedSpec.steps.length > 0) {
        // ── Execute ALL steps via Playwright (no BrowserView) ──
        const { browseOpen, browseSnapshot, browseClose } = await import('./services/playwrightService');
        const firstStep = parsedSpec.steps[0];
        mainWindow.webContents.send('worker:step-updated', { specId, stepIndex: 0, status: 'running' });

        // Open a single Playwright session for all steps
        const sessionId = `spec_${specId}`;
        await browseOpen(firstStep.url, sessionId);

        // Execute worker on step 1
        let allExtractedData = '';
        const step1Data = await executeWorkerOnView(db, sessionId, firstStep.instruction, mainWindow);
        allExtractedData += `\n--- ${firstStep.instruction} ---\n${typeof step1Data === 'string' ? step1Data : JSON.stringify(step1Data)}\n`;
        mainWindow.webContents.send('worker:step-updated', { specId, stepIndex: 0, status: 'completed' });

        // Steps 2+: Navigate (if different URL) then run worker
        let currentUrl = firstStep.url;
        for (let i = 1; i < parsedSpec.steps.length; i++) {
          const step = parsedSpec.steps[i];
          mainWindow.webContents.send('worker:step-updated', { specId, stepIndex: i, status: 'running' });

          const normalizeUrl = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');
          if (normalizeUrl(step.url) !== normalizeUrl(currentUrl)) {
            await browseOpen(step.url, sessionId); // Reuses same sessionId
            currentUrl = step.url;
          }

          const stepData = await executeWorkerOnView(db, sessionId, step.instruction, mainWindow);
          allExtractedData += `\n--- ${step.instruction} ---\n${typeof stepData === 'string' ? stepData : JSON.stringify(stepData)}\n`;
          mainWindow.webContents.send('worker:step-updated', { specId, stepIndex: i, status: 'completed' });
        }

        // Cleanup the Playwright session
        await browseClose(sessionId);

        // Synthesize conversational reply
        const conversationalReply = await synthesizeTaskResponse(db, parsedSpec.goal, allExtractedData);
        const replyId = uuidv4();
        saveMessage(db, { id: replyId, role: 'assistant', content: conversationalReply });
        saveMessage(db, {
          id: specId, role: 'assistant', content: '', type: 'spec',
          specData: JSON.stringify({
            goal: parsedSpec.goal, status: 'completed',
            steps: parsedSpec.steps.map((s: any) => ({ label: `nav → ${s.url}`, status: 'completed' })),
            data: allExtractedData
          })
        });

        mainWindow.webContents.send('worker:step-updated', {
          specId, stepIndex: parsedSpec.steps.length - 1, status: 'completed',
          data: allExtractedData, conversationalReply, replyId
        });
        notifyChatResponse(conversationalReply);
        db.prepare("UPDATE LivingSpecs SET status = 'COMPLETED' WHERE id = ?").run(specId);
      } else {
        db.prepare("UPDATE LivingSpecs SET status = 'COMPLETED' WHERE id = ?").run(specId);
      }
      return { status: 'OK' };
    } catch (e) {
      console.error('Execute Spec Failed:', e);
      if (mainWindow) {
        mainWindow.webContents.send('worker:step-updated', { specId, stepIndex: 0, status: 'failed', error: String(e) });
      }
      db.prepare("UPDATE LivingSpecs SET status = 'FAILED' WHERE id = ?").run(specId);
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ─── Skill Task Execution (ReAct loop via exec/read_file) ──────────
  ipcMain.handle('orchestrator:execute-skill-task', async (_event, specId: string) => {
    try {
      if (!mainWindow) throw new Error('MainWindow not defined');
      if (!db) throw new Error('DB not initialized');

      const row = db.prepare('SELECT * FROM LivingSpecs WHERE id = ?').get(specId);
      if (!row) throw new Error('Spec not found');

      const parsedSpec = JSON.parse(row.specJson);
      const task: string = parsedSpec.task || parsedSpec.goal || '';
      const skillName: string | undefined = parsedSpec.use_skill || undefined;
      if (!task && !skillName) throw new Error('Spec has no task or use_skill');

      db.prepare("UPDATE LivingSpecs SET status = 'ACTIVE' WHERE id = ?").run(specId);
      mainWindow.webContents.send('worker:step-updated', { specId, stepIndex: 0, status: 'running' });

      const result = await executeSkillTask(db, { task, skillName }, mainWindow);
      const rendered = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const conversationalReply = await synthesizeTaskResponse(db, parsedSpec.goal, rendered);

      const replyId = uuidv4();
      saveMessage(db, { id: replyId, role: 'assistant', content: conversationalReply });
      saveMessage(db, {
        id: specId, role: 'assistant', content: '',
        type: 'spec',
        specData: JSON.stringify({
          goal: parsedSpec.goal, status: 'completed',
          steps: [{ label: skillName ? `skill → ${skillName}` : 'task → exec', status: 'completed' }],
          data: rendered,
        }),
      });

      mainWindow.webContents.send('worker:step-updated', {
        specId, stepIndex: 0, status: 'completed',
        data: rendered, conversationalReply, replyId,
      });
      notifyChatResponse(conversationalReply);
      db.prepare("UPDATE LivingSpecs SET status = 'COMPLETED' WHERE id = ?").run(specId);
      return { status: 'OK' };
    } catch (e) {
      console.error('Skill Task Execution Failed:', e);
      if (mainWindow) {
        mainWindow.webContents.send('worker:step-updated', { specId, stepIndex: 0, status: 'failed', error: String(e) });
      }
      if (db) db.prepare("UPDATE LivingSpecs SET status = 'FAILED' WHERE id = ?").run(specId);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('browser:show', async (event, viewId: string) => {
    try {
      if (!mainWindow) throw new Error('MainWindow not defined');
      return showBrowserView(mainWindow, viewId);
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('browser:hide', async (event, viewId: string) => {
    try {
      if (!mainWindow) throw new Error('MainWindow not defined');
      return hideBrowserView(mainWindow, viewId);
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('browser:resume', async (event, viewId: string) => {
    try {
      return resumeViewExtraction(viewId);
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // Auth gate: user clicked "já loguei" — resolve the pending auth Promise
  ipcMain.handle('browser:resume-auth', async (event, viewId: string) => {
    try {
      const resolved = resolveAuth(viewId);
      return { status: resolved ? 'OK' : 'NO_PENDING_AUTH' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // HITL consent gate: user approved or denied a sensitive action
  ipcMain.handle('hitl:respond', async (event, requestId: string, approved: boolean) => {
    try {
      const resolved = resolveHumanConsent(requestId, approved);
      return { status: resolved ? 'OK' : 'NO_PENDING_CONSENT' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // Agent runner: abort a run by sessionId (Spec 09)
  ipcMain.handle('runAgent:abort', async (_event, sessionId: string) => {
    try {
      const aborted = abortRun(sessionId, 'user');
      return { status: aborted ? 'OK' : 'NO_ACTIVE_RUN' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // Agent runner: list currently active runs (Spec 09)
  ipcMain.handle('runAgent:active', async () => {
    try {
      return { status: 'OK', runs: listActiveRuns() };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ─── Session / Archive handlers ─────────────────────────────────
  ipcMain.handle('chat:save-message', async (event, msg: any) => {
    try {
      if (!db) throw new Error('DB not initialized');
      saveMessage(db, msg);
      // Run archiving opportunistically (async, fire-and-forget)
      const userDataPath = app.getPath('userData');
      archiveOldMessages(db, userDataPath);
      // Run context compaction in background (fire-and-forget)
      compactHistoryIfNeeded(db).catch(() => { });
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('chat:get-messages', async (event, limit: number, offset: number) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const msgs = getMessages(db, limit, offset);
      return { status: 'OK', data: msgs };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('chat:get-archives', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const archives = listArchiveFiles(userDataPath);
      return { status: 'OK', data: archives };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('chat:delete-archive', async (event, filename: string) => {
    try {
      const userDataPath = app.getPath('userData');
      const ok = deleteArchiveFile(userDataPath, filename);
      return { status: ok ? 'OK' : 'ERROR', error: ok ? undefined : 'File not found' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ─── Factory Reset ─────────────────────────────────────────────
  ipcMain.handle('factory-reset', async () => {
    try {
      if (!db) throw new Error('DB not initialized');
      const userDataPath = app.getPath('userData');
      factoryReset(db, userDataPath);

      // Clear browser sessions (cookies, localStorage, cache)
      const partitions = ['persist:redbus', 'persist:m365', 'persist:outlook', 'persist:teams'];
      let totalCookiesRemoved = 0;

      for (const partition of partitions) {
        const persistSession = session.fromPartition(partition);

        // Clear all storage types explicitly
        await persistSession.clearStorageData({
          storages: [
            'cookies', 'filesystem', 'indexdb', 'localstorage',
            'shadercache', 'websql', 'serviceworkers', 'cachestorage'
          ]
        });

        // Force-clear all cookies individually
        const cookies = await persistSession.cookies.get({});
        for (const cookie of cookies) {
          const protocol = cookie.secure ? 'https' : 'http';
          const cookieUrl = `${protocol}://${cookie.domain?.replace(/^\./, '')}${cookie.path || '/'}`;
          try {
            await persistSession.cookies.remove(cookieUrl, cookie.name);
            totalCookiesRemoved++;
          } catch { /* ignore individual cookie removal errors */ }
        }

        await persistSession.clearCache();
        await persistSession.clearAuthCache();
      }

      console.log(`[FactoryReset] Browser sessions cleared. Removed ${totalCookiesRemoved} cookies across ${partitions.length} partitions.`);

      return { status: 'OK' };
    } catch (e) {
      console.error('Factory Reset Failed:', e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ─── Onboarding / Setup (Spec 08) ──────────────────────────────
  ipcMain.handle('setup:status', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const completedAt = getAppSetting(db, 'setup.completedAt');
      const row = db.prepare('SELECT openAiKey, anthropicKey, googleKey, ollamaCloudKey, ollamaUrl, roles FROM ProviderConfigs WHERE id = 1').get() as any;
      const roles = parseRolesJson(row?.roles);
      const configured: Record<RoleName, boolean> = {
        planner: !!roles.planner?.model,
        executor: !!roles.executor?.model,
        synthesizer: !!roles.synthesizer?.model,
        utility: !!roles.utility?.model,
        digest: !!roles.digest?.model,
      };
      const hasAnyKey = !!(row?.openAiKey || row?.anthropicKey || row?.googleKey || row?.ollamaCloudKey);
      // `digest` is optional — it falls back to utility/executor at call sites
      // and is excluded from the completion check so existing installs don't
      // get kicked back into onboarding after upgrading.
      const allRolesConfigured = REQUIRED_ROLE_NAMES.every((r) => configured[r]);
      // Grandfather existing installs: if keys + all roles are present but no flag,
      // stamp the flag now so we don't force the wizard on users upgrading to Spec 08.
      if (!completedAt && hasAnyKey && allRolesConfigured) {
        setAppSetting(db, 'setup.completedAt', new Date().toISOString());
      }
      const effectiveCompletedAt = completedAt || (hasAnyKey && allRolesConfigured ? new Date().toISOString() : null);
      return {
        status: 'OK',
        data: {
          completed: !!effectiveCompletedAt,
          completedAt: effectiveCompletedAt,
          hasAnyKey,
          allRolesConfigured,
          rolesConfigured: configured,
        },
      };
    } catch (e) {
      console.error('setup:status failed:', e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('setup:complete', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      setAppSetting(db, 'setup.completedAt', new Date().toISOString());
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('setup:reset', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      db.prepare("DELETE FROM AppSettings WHERE key = 'setup.completedAt'").run();
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // Recommend a RolesMap given the models the user can currently reach.
  // `availableByProvider` maps provider id → list of model ids.
  ipcMain.handle('setup:recommend-roles', async (_event, availableByProvider: Record<string, string[]>) => {
    try {
      const providers = listProviders();
      const recommended: RolesMap = {};
      // Role priority: anthropic > openai > google for planner; google > openai for executor; haiku > nano > flash for synth/utility.
      for (const role of ROLE_NAMES) {
        for (const provider of providers) {
          const fn = provider.recommendedFor?.[role];
          if (!fn) continue;
          const models = availableByProvider[provider.id] || [];
          if (models.length === 0) continue;
          const rec = fn(models);
          if (!rec) continue;
          if (!recommended[role]) {
            recommended[role] = { model: rec.model, thinkingLevel: rec.thinkingLevel };
          }
        }
      }
      return { status: 'OK', data: recommended };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ─── Secure Vault ──────────────────────────────────────────────
  ipcMain.handle('vault:save-secret', async (_event, id: string, serviceName: string, token: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      saveSecret(db, id, serviceName, token);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('vault:list-secrets', async () => {
    try {
      if (!db) throw new Error('DB not initialized');
      return { status: 'OK', data: listSecrets(db) };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('vault:delete-secret', async (_event, id: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      deleteSecret(db, id);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ─── Skills CRUD (Markdown playbooks) ──────────
  ipcMain.handle('skill:list', async () => {
    try {
      if (!db) throw new Error('DB not initialized');
      const skills = listSkills(db);
      const mapped = skills.map(rec => ({
        name: rec.name,
        description: rec.description,
        dir: rec.dir,
        emoji: rec.frontmatter.metadata?.emoji || null,
        requires_env: rec.frontmatter.metadata?.requires?.env || [],
        requires_bins: rec.frontmatter.metadata?.requires?.bins || [],
        homepage: rec.frontmatter.homepage || null,
        mtimeMs: rec.mtimeMs,
      }));
      return { status: 'OK', data: mapped };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('skill:get', async (_event, name: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const rec = readSkill(name);
      if (!rec) return { status: 'ERROR', error: 'Skill not found' };
      return {
        status: 'OK', data: {
          name: rec.frontmatter.name,
          description: rec.frontmatter.description,
          body: rec.body,
          dir: rec.dir,
          bodyPath: rec.bodyPath,
          frontmatter: rec.frontmatter,
          scripts: rec.scripts,
          references: rec.references,
          assets: rec.assets,
        }
      };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('skill:update', async (_event, skill: { name: string; description: string; body: string; metadata?: any; homepage?: string }) => {
    try {
      if (!db) throw new Error('DB not initialized');
      writeSkill({
        name: skill.name,
        description: skill.description,
        body: skill.body,
        metadata: skill.metadata,
        homepage: skill.homepage,
      });
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('skill:delete', async (_event, name: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      deleteSkill(name);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // Routine handlers
  // ═══════════════════════════════════════════

  ipcMain.handle('routine:list', async () => {
    try {
      if (!db) throw new Error('DB not initialized');
      const rows = db.prepare(
        `SELECT id, conversationId, status, specJson, cron_expression, last_run,
                enabled, next_run_at, consecutive_errors, last_error, last_duration_ms, timezone
         FROM LivingSpecs
         WHERE cron_expression IS NOT NULL
         ORDER BY enabled DESC, next_run_at ASC`
      ).all();

      const routines = rows.map((r: any) => {
        let spec: any = {};
        try { spec = JSON.parse(r.specJson); } catch { }
        return {
          id: r.id,
          goal: spec.goal || '',
          cron_expression: r.cron_expression,
          enabled: r.enabled !== 0,
          status: r.status,
          next_run_at: r.next_run_at,
          last_run: r.last_run,
          last_error: r.last_error,
          consecutive_errors: r.consecutive_errors || 0,
          last_duration_ms: r.last_duration_ms,
          timezone: r.timezone || 'America/Sao_Paulo',
          // Pipeline info
          skill_name: spec.use_skill || spec.skill_name || null,
          skill_task: !!(spec.task || spec.use_skill),
          steps: (spec.steps || []).map((s: any) => ({ url: s.url, instruction: s.instruction })),
        };
      });
      return { status: 'OK', data: routines };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('routine:pause', async (_event, specId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      db.prepare('UPDATE LivingSpecs SET enabled = 0 WHERE id = ?').run(specId);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('routine:resume', async (_event, specId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const row = db.prepare('SELECT cron_expression, timezone FROM LivingSpecs WHERE id = ?').get(specId) as any;
      const nextRun = row?.cron_expression ? computeNextRun(row.cron_expression, row.timezone) : null;
      db.prepare('UPDATE LivingSpecs SET enabled = 1, consecutive_errors = 0, last_error = NULL, next_run_at = ? WHERE id = ?')
        .run(nextRun, specId);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('routine:delete', async (_event, specId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      db.prepare('DELETE FROM RoutineExecutions WHERE specId = ?').run(specId);
      db.prepare('DELETE FROM LivingSpecs WHERE id = ?').run(specId);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('routine:run-now', async (_event, specId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const result = await runRoutineNow(db, mainWindow, specId);
      // Notify only if app is not focused (user may have switched away)
      const goal = result.summary || specId;
      notifyManualRoutine(goal, result.summary, result.status !== 'ok');
      return { status: result.status === 'ok' ? 'OK' : 'ERROR', data: result };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('routine:update-cron', async (_event, specId: string, cronExpr: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      // Validate cron expression
      const nextRun = computeNextRun(cronExpr);
      if (!nextRun) throw new Error('Invalid cron expression');
      // Update spec JSON too
      const row = db.prepare('SELECT specJson, timezone FROM LivingSpecs WHERE id = ?').get(specId) as any;
      if (!row) throw new Error('Routine not found');
      const spec = JSON.parse(row.specJson);
      spec.cron_expression = cronExpr;
      db.prepare(
        'UPDATE LivingSpecs SET cron_expression = ?, specJson = ?, next_run_at = ? WHERE id = ?'
      ).run(cronExpr, JSON.stringify(spec), nextRun, specId);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('routine:history', async (_event, specId: string, limit = 20) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const rows = db.prepare(
        'SELECT * FROM RoutineExecutions WHERE specId = ? ORDER BY startedAt DESC LIMIT ?'
      ).all(specId, limit);
      return { status: 'OK', data: rows };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // Memory handlers
  // ═══════════════════════════════════════════

  ipcMain.handle('memory:search', async (_event, query: string, limit = 10) => {
    try {
      if (!db) throw new Error('DB not initialized');
      return { status: 'OK', data: searchMemory(db, query, limit) };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('memory:facts', async () => {
    try {
      if (!db) throw new Error('DB not initialized');
      return { status: 'OK', data: getActiveFacts(db, 100) };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // Notification handlers
  // ═══════════════════════════════════════════

  ipcMain.handle('notification:send', async (_event, title: string, body: string) => {
    try {
      sendOSNotification(title, body);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // Sensor handlers
  // ═══════════════════════════════════════════

  ipcMain.handle('sensor:toggle', async (_event, sensorId: string, enabled: boolean) => {
    try {
      toggleSensor(sensorId, enabled);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('sensor:status', async () => {
    try {
      return { status: 'OK', data: getSensorStatuses() };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // Proactivity Engine status
  // ═══════════════════════════════════════════

  ipcMain.handle('proactivity:status', async () => {
    try {
      const status = getProactivityStatus();
      // Enrich with live sensor statuses
      const sensors = getSensorStatuses();
      status.sensorsActive = sensors.filter((s: any) => s.enabled).map((s: any) => s.id);
      return { status: 'OK', data: status };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('proactivity:get-level', async () => {
    try {
      if (!db) return { status: 'OK', data: 'MEDIUM' };
      const saved = getAppSetting(db, 'proactivity_level');
      return { status: 'OK', data: saved || 'MEDIUM' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('proactivity:set-level', async (_event, level: string) => {
    try {
      if (!db) return { status: 'ERROR', error: 'DB not initialized' };
      const valid = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];
      if (!valid.includes(level)) return { status: 'ERROR', error: `Invalid level: ${level}` };
      setAppSetting(db, 'proactivity_level', level);
      // Apply immediately to the running engine
      // setProactivityLevel already imported at top
      setProactivityLevel(level as any);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('proactivity:get-timings', async () => {
    try {
      // getLevelTimings already imported at top
      return { status: 'OK', data: getLevelTimings() };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('proactivity:set-timing', async (_event, level: string, intervalMs?: number, cooldownMs?: number) => {
    try {
      const valid = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];
      if (!valid.includes(level)) return { status: 'ERROR', error: `Invalid level: ${level}` };
      // setLevelTiming already imported at top
      setLevelTiming(level as any, intervalMs, cooldownMs);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // Screen Memory search
  // ═══════════════════════════════════════════

  ipcMain.handle('screen-memory:search', async (_event, query: string, limit?: number) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const results = searchScreenMemory(db, query, limit);
      return { status: 'OK', data: results };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // Accessibility tree (on-demand read)
  // ═══════════════════════════════════════════

  ipcMain.handle('accessibility:read-tree', async () => {
    try {
      const result = await readAccessibilityTree();
      if (!result) return { status: 'OK', data: { tree: [], nodeCount: 0, textSummary: '' } };
      return {
        status: 'OK',
        data: {
          appName: result.appName,
          windowTitle: result.windowTitle,
          tree: result.tree,
          nodeCount: result.nodeCount,
          textSummary: flattenTreeToText(result.tree, 2000),
        },
      };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // App Settings handlers
  // ═══════════════════════════════════════════

  ipcMain.handle('app-settings:get', async (_event, key: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const value = getAppSetting(db, key);
      if (key === 'transcription_mode') {
        console.log(`[AppSettings] transcription_mode = ${JSON.stringify(value)}`);
      }
      return { status: 'OK', data: value };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('app-settings:set', async (_event, key: string, value: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      setAppSetting(db, key, value);
      if (key === 'enableSubagents') syncSpawnSubagentTool(db);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('thinking:list-levels', async (_event, model: string) => {
    try {
      const provider = getProviderForModel(model);
      const cap = provider.capabilities?.thinking;
      if (!cap) return { status: 'OK', data: { supported: ['off'], default: 'off', providerId: provider.id } };
      return { status: 'OK', data: { supported: cap.supported, default: cap.default, providerId: provider.id } };
    } catch (e) {
      return { status: 'OK', data: { supported: ALL_THINK_LEVELS, default: 'medium', providerId: null, error: String(e) } };
    }
  });

  ipcMain.handle('settings:cleanup-now', async () => {
    try {
      if (!db) throw new Error('DB not initialized');
      const deleted = cleanupOldMemories(db);
      return { status: 'OK', data: { deleted } };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // Audio Sensor / Meeting Memory
  // ═══════════════════════════════════════════

  ipcMain.handle('audio:process-meeting', async (_event, audioArrayBuffer: ArrayBuffer, mimeType: string) => {
    try {
      if (!db) throw new Error('DB not initialized');

      // Backend always uses CLOUD engine — local STT is handled
      // in the renderer Web Worker before reaching this handler.
      const engine = getAppSetting(db, 'transcription_engine') || 'gemini';
      console.log(`[AudioSensor] Processing via cloud engine=${engine}`);

      const configs = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
      if (!configs) throw new Error('Provider configs not found');

      const buffer = Buffer.from(audioArrayBuffer);
      const analysis = await processAudio(db, buffer, mimeType, engine as any, configs);

      // DON'T save immediately — return data for interactive review
      return { status: 'OK', data: { summary: analysis.summary_json, raw_transcript: analysis.raw_transcript, provider_used: analysis.provider_used } };
    } catch (e) {
      console.error('[AudioSensor] Processing failed:', e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ── Text-only path: receives pre-transcribed text from renderer Web Worker (HYBRID_LOCAL) ──
  ipcMain.handle('audio:process-transcript', async (_event, transcript: string) => {
    try {
      if (!db) throw new Error('DB not initialized');

      const configs = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
      if (!configs) throw new Error('Provider configs not found');

      // analyzeTranscriptFromText already imported at top
      console.log(`[AudioSensor] Processing pre-transcribed text (${transcript.length} chars) via cloud NLP...`);

      const summary_json = await analyzeTranscriptFromText(db, transcript);

      // DON'T save — return data for interactive review
      return { status: 'OK', data: { summary: summary_json, raw_transcript: transcript, provider_used: 'local' } };
    } catch (e) {
      console.error('[AudioSensor] Transcript processing failed:', e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ── HYBRID_LOCAL: full pipeline in main process — local STT + cloud NLP ──
  // Receives PCM Float32 data (already decoded in renderer via OfflineAudioContext)
  ipcMain.handle('audio:process-hybrid', async (_event, pcmArrayBuffer: ArrayBuffer, _format: string) => {
    try {
      if (!db) throw new Error('DB not initialized');

      const configs = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
      if (!configs) throw new Error('Provider configs not found');

      // Convert ArrayBuffer to Float32Array (PCM 16kHz mono from renderer)
      const pcmFloat32 = new Float32Array(pcmArrayBuffer);
      console.log(`[AudioSensor] HYBRID_LOCAL: Starting local STT (${pcmFloat32.length} samples, ${(pcmFloat32.length / 16000).toFixed(1)}s)...`);

      // Step 1: Local STT via worker_threads (whisper-tiny) — receives Float32Array directly
      const { transcribeLocally: localSTT } = await import('./services/localTranscriber');
      const { text: transcript, duration_ms } = await localSTT(pcmFloat32);
      console.log(`[AudioSensor] HYBRID_LOCAL: Local STT done in ${duration_ms}ms (${transcript.length} chars)`);

      if (!transcript || transcript.trim().length === 0) {
        throw new Error('Local transcription produced empty result');
      }

      // Step 2: Cloud NLP (text only — no audio sent)
      console.log(`[AudioSensor] HYBRID_LOCAL: Sending text to cloud NLP...`);
      const summary_json = await analyzeTranscriptFromText(db, transcript);

      return { status: 'OK', data: { summary: summary_json, raw_transcript: transcript, provider_used: 'local' } };
    } catch (e) {
      console.error('[AudioSensor] HYBRID_LOCAL failed:', e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ── Audio Routing (system audio capture via RedBus Audio Bridge) ──
  ipcMain.handle('audio-routing:get-strategy', async () => {
    try {
      const { getSystemAudioStrategy } = await import('./services/audioRoutingService');
      return { status: 'OK', data: getSystemAudioStrategy() };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('audio-routing:linux-monitor-source', async () => {
    try {
      const { getLinuxMonitorSource } = await import('./services/audioRoutingService');
      return { status: 'OK', data: getLinuxMonitorSource() };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('audio-routing:list-output-devices', async () => {
    try {
      const { listOutputDevices } = await import('./services/audioRoutingService');
      return { status: 'OK', data: listOutputDevices() };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('audio-routing:create-aggregate', async (_event, outputUID: string) => {
    try {
      const { createAggregate } = await import('./services/audioRoutingService');
      const result = createAggregate(outputUID);
      return { status: 'OK', data: result };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('audio-routing:destroy-aggregate', async (_event, aggregateID: number) => {
    try {
      const { destroyAggregate } = await import('./services/audioRoutingService');
      destroyAggregate(aggregateID);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('audio-routing:check-driver', async () => {
    try {
      const { getDriverStatus } = await import('./services/audioRoutingService');
      const status = getDriverStatus();
      return { status: 'OK', data: status };
    } catch (e) {
      return { status: 'OK', data: { driverInstalled: false, redbusUID: null, redbusName: null, needsSetup: true, setupInstructions: String(e) } };
    }
  });

  ipcMain.handle('audio-routing:start', async () => {
    try {
      const { startSystemAudioCapture } = await import('./services/audioRoutingService');
      const session = startSystemAudioCapture();
      return { status: 'OK', data: session };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('audio-routing:stop', async () => {
    try {
      const { stopSystemAudioCapture } = await import('./services/audioRoutingService');
      stopSystemAudioCapture();
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('audio-routing:setup', async () => {
    try {
      const { startSystemAudioCapture, startOutputWatcher } = await import('./services/audioRoutingService');
      const session = startSystemAudioCapture();
      if (!session.needsSetup && session.aggregateID > 0) {
        // Start watching for output changes so we can auto-recover
        startOutputWatcher((uid, name) => {
          console.log(`[AudioRouting] Output changed to: ${name} (${uid})`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('audio-routing:output-changed', { uid, name });
          }
        });
      }
      return { status: 'OK', data: session };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('audio-routing:reactivate', async () => {
    try {
      const { reactivateRouting } = await import('./services/audioRoutingService');
      const result = reactivateRouting();
      return { status: result.success ? 'OK' : 'ERROR', error: result.error };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('audio-routing:open-sound-settings', async () => {
    try {
      const { exec } = await import('child_process');
      exec('open "x-apple.systempreferences:com.apple.Sound-Settings.extension"');
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ── tl;dv Sensor ──
  ipcMain.handle('tldv:force-sync', async () => {
    try {
      const { forceSyncNow } = await import('./services/sensors/tldvSensor');
      const result = await forceSyncNow();
      return { status: result.success ? 'OK' : 'ERROR', data: result, error: result.error };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('tldv:sync-status', async () => {
    try {
      const { getTldvSyncStatus } = await import('./services/sensors/tldvSensor');
      return { status: 'OK', data: getTldvSyncStatus() };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ── Save reviewed meeting (after user edits in Ata Viva) ──
  ipcMain.handle('meeting:save-review', async (_event, data: { raw_transcript: string; summary_json: any; provider_used: string }) => {
    try {
      if (!db) throw new Error('DB not initialized');
      // saveMeetingMemory + sendOSNotification already imported at top

      const meetingId = saveMeetingMemory(db, {
        provider_used: data.provider_used as any,
        raw_transcript: data.raw_transcript,
        summary_json: data.summary_json,
      });

      sendOSNotification('RedBus', `Ata da reunião salva. ${data.summary_json.decisions?.length || 0} decisões, ${data.summary_json.action_items?.length || 0} action items.`);

      return { status: 'OK', data: { meetingId } };
    } catch (e) {
      console.error('[MeetingReview] Save failed:', e);
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('meeting-memory:search', async (_event, query: string, limit?: number) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const results = searchMeetingMemory(db, query, limit);
      return { status: 'OK', data: results };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ── Meetings list & details ──
  ipcMain.handle('meetings:add-manual', async (_event, payload: ManualMeetingPayload) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const meetingId = addManualMeeting(db, payload);
      return { status: 'OK', data: { meetingId } };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('meetings:list', async (_event, limit?: number, offset?: number) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const results = listMeetings(db, limit || 50, offset || 0);
      return { status: 'OK', data: results };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('meetings:get-details', async (_event, meetingId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const meeting = getMeetingDetails(db, meetingId);
      if (!meeting) return { status: 'ERROR', error: 'Meeting not found' };
      return { status: 'OK', data: meeting };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('meetings:get-context', async (_event, meetingId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const context = getMeetingContextForPrompt(db, meetingId);
      if (!context) return { status: 'ERROR', error: 'Meeting not found' };
      return { status: 'OK', data: context };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // Activity Console handlers
  // ═══════════════════════════════════════════

  ipcMain.handle('activity:get-recent-logs', async (_event, limit?: number) => {
    try {
      return { status: 'OK', data: getRecentLogs(limit) };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('activity:clear-logs', async () => {
    try {
      clearLogBuffer();
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('meetings:delete', async (_event, meetingId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const deleted = deleteMeeting(db, meetingId);
      if (!deleted) return { status: 'ERROR', error: 'Meeting not found' };
      return { status: 'OK', data: { deleted: true } };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ── Communication Digests ──
  // Helper: send progress events to renderer
  const sendDigestProgress = (step: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('digest:progress', step);
    }
  };

  // digest:generate runs in background — returns immediately so UI stays responsive.
  // Progress is sent via digest:progress events.
  // On completion, sends digest:complete or digest:error event.
  ipcMain.handle('digest:generate', async (_event, targetDate?: string) => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    const date = targetDate || new Date().toISOString().slice(0, 10);

    // Fire-and-forget: run in background
    (async () => {
      try {
        // Step 1: Pull all ingested items for the day from RawCommunications
        sendDigestProgress('carregando mensagens do dia...');
        const { listCommunications } = await import('./services/communicationsStore');
        const sinceIso = `${date}T00:00:00.000Z`;
        const all = listCommunications(db, { since: sinceIso, limit: 2000 });
        const messages: DigestMessage[] = all
          .filter(c => c.timestamp.slice(0, 10) === date)
          .map(c => ({
            channel: c.source === 'outlook' ? 'Outlook' : 'Teams',
            sender: c.sender,
            subject: c.subject || '',
            preview: c.plainText.slice(0, 500),
            timestamp: c.timestamp,
            isUnread: c.isUnread,
            importance: c.importance,
            mentionsMe: c.mentionsMe,
          }));

        console.log(`[Digest] ${all.length} items loaded, ${messages.length} match date ${date}`);

        if (messages.length === 0) {
          sendDigestProgress('');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('digest:error', { date, error: 'nenhuma mensagem para o dia' });
          }
          return;
        }

        // Step 3: LLM processing
        sendDigestProgress(`processando ${messages.length} mensagens com IA...`);
        const { callWorkerRaw } = await import('./services/llmService');
        const callLLM = async (prompt: string) => {
          return callWorkerRaw(db, 'Você é um assistente executivo. Retorne APENAS JSON válido sem markdown.', prompt);
        };
        // Load professional identity so the LLM can reason about addressing.
        const userContext = loadProfessionalIdentity(db);
        const summary = await generateDigestFromMessages(messages, callLLM, userContext);

        // Step 4: Save
        sendDigestProgress('salvando digest...');
        db.prepare('DELETE FROM CommunicationDigest WHERE digest_date = ?').run(date);
        const id = saveDigest(db, date, 'all', summary, messages);

        sendDigestProgress('');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('digest:complete', { date, id, summary });
        }
      } catch (e) {
        sendDigestProgress('');
        console.error('[Digest] Generation failed:', e);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('digest:error', { date, error: String(e) });
        }
      }
    })();

    // Return immediately — UI can continue
    return { status: 'OK', data: { started: true, date } };
  });

  ipcMain.handle('digest:list', async (_event, limit?: number) => {
    try {
      if (!db) throw new Error('DB not initialized');
      return { status: 'OK', data: listDigests(db, limit || 30) };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('digest:get-details', async (_event, digestId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const d = getDigestDetails(db, digestId);
      if (!d) return { status: 'ERROR', error: 'Digest not found' };
      return { status: 'OK', data: d };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('digest:get-by-date', async (_event, date: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const d = getDigestByDate(db, date);
      return { status: 'OK', data: d };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('digest:delete', async (_event, digestId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const deleted = deleteDigest(db, digestId);
      if (!deleted) return { status: 'ERROR', error: 'Not found' };
      return { status: 'OK', data: { deleted: true } };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // Spec 11 — Communications Hub (Microsoft Graph)
  // ═══════════════════════════════════════════

  ipcMain.handle('comms:auth-start', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const { startDeviceCodeFlow, pollDeviceCodeToken } = await import('./services/graph/graphAuthService');
      const start = await startDeviceCodeFlow();
      // Open MS verification URL in the default browser + fire poll in background.
      try { const { shell } = await import('electron'); await shell.openExternal(start.verificationUri); } catch { }
      (async () => {
        const ok = await pollDeviceCodeToken(db, start);
        if (mainWindow && !mainWindow.isDestroyed()) {
          const { getAuthStatus } = await import('./services/graph/graphAuthService');
          mainWindow.webContents.send('comms:auth-status', { ...getAuthStatus(db), completed: ok });
          // First poll right after auth completes
          if (ok) {
            try {
              const { pollNow } = await import('./services/graph/graphScheduler');
              await pollNow(db);
            } catch { /* logged downstream */ }
          }
        }
      })();
      return {
        status: 'OK',
        data: {
          userCode: start.userCode,
          verificationUri: start.verificationUri,
          expiresIn: start.expiresIn,
          interval: start.interval,
          message: start.message,
        },
      };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('comms:auth-status', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const { getAuthStatus } = await import('./services/graph/graphAuthService');
      return { status: 'OK', data: getAuthStatus(db) };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('comms:auth-disconnect', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const { disconnectGraph } = await import('./services/graph/graphAuthService');
      disconnectGraph(db);
      return { status: 'OK' };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('comms:list', async (_event, filter?: { since?: string; until?: string; limit?: number; sources?: ('outlook' | 'teams')[] }) => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const { listCommunications } = await import('./services/communicationsStore');
      return { status: 'OK', data: listCommunications(db, filter || {}) };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('comms:refresh', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const { pollNow } = await import('./services/graph/graphScheduler');
      const r = await pollNow(db);
      return { status: 'OK', data: r };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // Backfill mail + teams for a specific calendar day (YYYY-MM-DD, local).
  // Ingests into RawCommunications; idempotent via upsert-by-graphId.
  // Emits `comms:backfill-progress` events so the UI can render a staged
  // progress indicator instead of a generic "loading" label.
  ipcMain.handle('comms:backfill-date', async (_event, date: string) => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { status: 'ERROR', error: 'data inválida (esperado YYYY-MM-DD)' };
    }
    const sendProgress = (payload: { stage: 'start' | 'outlook' | 'teams' | 'done'; status: 'running' | 'ok' | 'error'; count?: number; error?: string }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('comms:backfill-progress', { date, ...payload });
      }
    };
    try {
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(start.getTime() + 24 * 3600 * 1000);
      const since = start.toISOString();
      const until = end.toISOString();
      const { fetchMessagesInRange } = await import('./services/graph/graphMailService');
      const { fetchChatMessagesInRange } = await import('./services/graph/graphTeamsService');
      let ingested = 0;
      sendProgress({ stage: 'start', status: 'running' });

      sendProgress({ stage: 'outlook', status: 'running' });
      try {
        const n = await fetchMessagesInRange(db, since, until);
        ingested += n;
        sendProgress({ stage: 'outlook', status: 'ok', count: n });
      } catch (e: any) {
        sendProgress({ stage: 'outlook', status: 'error', error: String(e?.message || e) });
      }

      sendProgress({ stage: 'teams', status: 'running' });
      try {
        const n = await fetchChatMessagesInRange(db, since, until);
        ingested += n;
        sendProgress({ stage: 'teams', status: 'ok', count: n });
      } catch (e: any) {
        sendProgress({ stage: 'teams', status: 'error', error: String(e?.message || e) });
      }

      sendProgress({ stage: 'done', status: 'ok', count: ingested });
      return { status: 'OK', data: { ingested, date } };
    } catch (e) {
      sendProgress({ stage: 'done', status: 'error', error: String(e) });
      return { status: 'ERROR', error: String(e) };
    }
  });

  // Fire-and-forget digest from a curated set of raw-comm ids.
  // Always uses the dedicated `digest` role when configured, falling back to
  // `utility` then `executor` so existing installs without digest keep working.
  ipcMain.handle('comms:generate-digest', async (_event, payload: { date?: string; itemIds: string[] }) => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    const date = payload?.date || new Date().toISOString().slice(0, 10);
    const itemIds = Array.isArray(payload?.itemIds) ? payload.itemIds : [];
    const resolveDigestRole = (): RoleName => {
      for (const candidate of ['digest', 'utility', 'executor'] as const) {
        try { resolveRole(db, candidate); return candidate; } catch (e) { if (!(e instanceof SetupRequiredError)) throw e; }
      }
      throw new SetupRequiredError('digest');
    };
    if (itemIds.length === 0) return { status: 'ERROR', error: 'nenhum item selecionado' };
    // Raw cap — dedup shrinks this further before hitting the LLM.
    if (itemIds.length > 400) return { status: 'ERROR', error: 'limite de 400 itens por digest — refine os filtros' };

    (async () => {
      try {
        const role = resolveDigestRole();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('digest:progress', 'montando payload curado...');
        const { getCommunicationsByIds } = await import('./services/communicationsStore');
        const rawItems = getCommunicationsByIds(db, itemIds);
        // Spec 11 §7 — semantic curation: drop noise (acks/emoji-only), always
        // keep signal (importance/mentions/questions/URLs/long bodies), cap
        // neutral chatter per thread. Settings persisted in AppSettings under
        // `comms.digest.curation` and edited by the user in the Digest tab.
        const curationRaw = getAppSetting(db, 'comms.digest.curation');
        let curationCfg: DigestCurationConfig = DEFAULT_DIGEST_CURATION;
        if (curationRaw) {
          try { curationCfg = { ...DEFAULT_DIGEST_CURATION, ...JSON.parse(curationRaw) }; }
          catch (e) { console.warn('[comms:generate-digest] bad curation config, using defaults:', e); }
        }
        const curated = curateDigestMessages(rawItems, curationCfg);
        const rank = (imp?: string) => (imp === 'high' ? 2 : imp === 'normal' ? 1 : 0);
        curated.sort((a, b) => {
          const d1 = rank(b.importance) - rank(a.importance); if (d1) return d1;
          const d2 = Number(!!b.mentionsMe) - Number(!!a.mentionsMe); if (d2) return d2;
          return (a.timestamp || '').localeCompare(b.timestamp || '');
        });
        const messages: DigestMessage[] = curated.map(i => ({
          channel: i.source,
          sender: i.sender,
          subject: i.subject,
          preview: cleanPreview(i.plainText || '', i.source),
          timestamp: i.timestamp,
          isUnread: i.isUnread,
          importance: i.importance,
          mentionsMe: i.mentionsMe,
        }));

        if (mainWindow && !mainWindow.isDestroyed()) {
          const shrunk = rawItems.length !== messages.length ? ` (curadoria: ${rawItems.length}→${messages.length})` : '';
          mainWindow.webContents.send('digest:progress', `processando ${messages.length} mensagens com IA${shrunk} via ${role}...`);
        }
        const { callRoleRaw } = await import('./services/llmService');
        const callLLM = async (prompt: string) => callRoleRaw(db, role, 'Você é um assistente executivo. Retorne APENAS JSON válido sem markdown.', prompt);

        const userContext = loadProfessionalIdentity(db);

        const summary = await generateDigestFromMessages(messages, callLLM, userContext);

        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('digest:progress', 'salvando digest...');
        db.prepare('DELETE FROM CommunicationDigest WHERE digest_date = ?').run(date);
        const id = saveDigest(db, date, 'all', summary, messages);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('digest:progress', '');
          mainWindow.webContents.send('digest:complete', { date, id, summary });
        }
      } catch (e) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('digest:progress', '');
          mainWindow.webContents.send('digest:error', { date, error: String(e) });
        }
      }
    })();

    return { status: 'OK', data: { started: true, date, count: itemIds.length } };
  });

  ipcMain.handle('comms:filter-presets', async () => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const raw = getAppSetting(db, 'comms.filter_presets');
      const data = raw ? JSON.parse(raw) : [];
      return { status: 'OK', data: Array.isArray(data) ? data : [] };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('comms:filter-presets-save', async (_event, preset: any) => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const raw = getAppSetting(db, 'comms.filter_presets');
      let list: any[] = raw ? (JSON.parse(raw) || []) : [];
      // Only one preset may hold isDefault at a time — clear the flag on all
      // others whenever the incoming preset claims the default slot.
      if (preset && preset.isDefault) {
        list = list.map(p => p.id === preset.id ? p : { ...p, isDefault: false });
      }
      const idx = list.findIndex(p => p.id === preset.id);
      if (idx >= 0) list[idx] = preset; else list.push(preset);
      setAppSetting(db, 'comms.filter_presets', JSON.stringify(list));
      return { status: 'OK', data: list };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('comms:filter-presets-delete', async (_event, id: string) => {
    if (!db) return { status: 'ERROR', error: 'DB not initialized' };
    try {
      const raw = getAppSetting(db, 'comms.filter_presets');
      const list: any[] = raw ? (JSON.parse(raw) || []) : [];
      const next = list.filter(p => p.id !== id);
      setAppSetting(db, 'comms.filter_presets', JSON.stringify(next));
      return { status: 'OK', data: next };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  // ═══════════════════════════════════════════
  // To-Do handlers
  // ═══════════════════════════════════════════

  ipcMain.handle('todo:create', async (_event, payload: CreateTodoPayload) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const todo = createTodo(db, payload);
      return { status: 'OK', data: todo };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('todo:list', async (_event, includeArchived?: boolean) => {
    try {
      if (!db) throw new Error('DB not initialized');
      return { status: 'OK', data: listTodos(db, includeArchived) };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('todo:complete', async (_event, todoId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const success = completeTodo(db, todoId);
      if (!success) return { status: 'ERROR', error: 'Not found' };
      return { status: 'OK', data: { completed: true } };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('todo:archive', async (_event, todoId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const success = archiveTodo(db, todoId);
      if (!success) return { status: 'ERROR', error: 'Not found' };
      return { status: 'OK', data: { archived: true } };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('todo:unarchive', async (_event, todoId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const success = unarchiveTodo(db, todoId);
      if (!success) return { status: 'ERROR', error: 'Not found' };
      return { status: 'OK', data: { unarchived: true } };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('todo:delete', async (_event, todoId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const success = deleteTodo(db, todoId);
      if (!success) return { status: 'ERROR', error: 'Not found' };
      return { status: 'OK', data: { deleted: true } };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

  ipcMain.handle('todo:get', async (_event, todoId: string) => {
    try {
      if (!db) throw new Error('DB not initialized');
      const todo = getTodo(db, todoId);
      if (!todo) return { status: 'ERROR', error: 'Not found' };
      return { status: 'OK', data: todo };
    } catch (e) {
      return { status: 'ERROR', error: String(e) };
    }
  });

}
