import { contextBridge, ipcRenderer } from 'electron';
import type { RedBusAPI } from '../src/types/ipc';

const api: RedBusAPI = {
  sendTaskToOrchestrator: (specPayload: string) => ipcRenderer.invoke('orchestrator:send-task', specPayload),
  onMonitorStatus: () => ipcRenderer.invoke('monitor:get-status'),
  getProviderConfigs: () => ipcRenderer.invoke('settings:get'),
  getUserProfile: () => ipcRenderer.invoke('get-user-profile'),
  saveUserProfile: (profile) => ipcRenderer.invoke('save-user-profile', profile),
  getProfessionalProfile: () => ipcRenderer.invoke('user-profile:get-professional'),
  saveProfessionalProfile: (payload) => ipcRenderer.invoke('user-profile:save-professional', payload),
  saveProviderConfigs: (configs) => ipcRenderer.invoke('settings:save', configs),
  saveProviderConfig: (provider, apiKey, defaultModel) => ipcRenderer.invoke('settings:save-provider', provider, apiKey, defaultModel),
  runWorkerTest: (url, instruction) => ipcRenderer.invoke('run-worker-test', url, instruction),
  createSpecFromPrompt: (prompt, filePaths) => ipcRenderer.invoke('orchestrator:create-spec', prompt, filePaths),
  selectFiles: () => ipcRenderer.invoke('dialog:select-files'),

  showBrowserView: (viewId) => ipcRenderer.invoke('browser:show', viewId),
  hideBrowserView: (viewId) => ipcRenderer.invoke('browser:hide', viewId),
  resumeViewExtraction: (viewId) => ipcRenderer.invoke('browser:resume', viewId),
  resumeAuth: (viewId) => ipcRenderer.invoke('browser:resume-auth', viewId),
  respondToConsent: (requestId, approved) => ipcRenderer.invoke('hitl:respond', requestId, approved),
  abortAgentRun: (sessionId) => ipcRenderer.invoke('runAgent:abort', sessionId),
  listActiveAgentRuns: () => ipcRenderer.invoke('runAgent:active'),

  onAuthRequired: (callback) => {
    ipcRenderer.removeAllListeners('auth-required');
    ipcRenderer.on('auth-required', (_, data) => callback(data));
  },
  onAuthCompleted: (callback) => {
    ipcRenderer.removeAllListeners('auth-completed');
    ipcRenderer.on('auth-completed', (_, data) => callback(data));
  },
  onWorkerStepUpdate: (callback) => {
    ipcRenderer.removeAllListeners('worker:step-updated');
    ipcRenderer.on('worker:step-updated', (_, data) => callback(data));
  },
  onHitlConsentRequest: (callback) => {
    ipcRenderer.removeAllListeners('hitl-consent-request');
    ipcRenderer.on('hitl-consent-request', (_, data) => callback(data));
  },
  fetchAvailableModels: (provider, apiKey, customUrl) => ipcRenderer.invoke('settings:fetch-models', provider, apiKey, customUrl),
  executeSpec: (specId) => ipcRenderer.invoke('orchestrator:execute-spec', specId),
  executeSkillTask: (specId) => ipcRenderer.invoke('orchestrator:execute-skill-task', specId),

  getOllamaStatus: (url) => ipcRenderer.invoke('ollama:status', url),
  listOllamaModels: (url) => ipcRenderer.invoke('ollama:list', url),
  pullOllamaModel: (modelTag, url) => ipcRenderer.invoke('ollama:pull', modelTag, url),
  onOllamaPullProgress: (callback) => {
    ipcRenderer.removeAllListeners('ollama:pull-progress');
    ipcRenderer.on('ollama:pull-progress', (_, data) => callback(data));
  },

  saveMessage: (msg) => ipcRenderer.invoke('chat:save-message', msg),
  getMessages: (limit, offset) => ipcRenderer.invoke('chat:get-messages', limit, offset),
  getArchives: () => ipcRenderer.invoke('chat:get-archives'),
  deleteArchive: (filename) => ipcRenderer.invoke('chat:delete-archive', filename),
  factoryReset: () => ipcRenderer.invoke('factory-reset'),

  // Onboarding / Setup
  getSetupStatus: () => ipcRenderer.invoke('setup:status'),
  markSetupComplete: () => ipcRenderer.invoke('setup:complete'),
  resetSetup: () => ipcRenderer.invoke('setup:reset'),
  recommendRoles: (availableByProvider) => ipcRenderer.invoke('setup:recommend-roles', availableByProvider),

  // Vault
  saveVaultSecret: (id, serviceName, token) => ipcRenderer.invoke('vault:save-secret', id, serviceName, token),
  listVaultSecrets: () => ipcRenderer.invoke('vault:list-secrets'),
  deleteVaultSecret: (id) => ipcRenderer.invoke('vault:delete-secret', id),

  // Skill Library
  listSkills: () => ipcRenderer.invoke('skill:list'),
  getSkill: (name) => ipcRenderer.invoke('skill:get', name),
  updateSkill: (skill) => ipcRenderer.invoke('skill:update', skill),
  deleteSkill: (name) => ipcRenderer.invoke('skill:delete', name),

  // Routines
  listRoutines: () => ipcRenderer.invoke('routine:list'),
  pauseRoutine: (specId) => ipcRenderer.invoke('routine:pause', specId),
  resumeRoutine: (specId) => ipcRenderer.invoke('routine:resume', specId),
  deleteRoutine: (specId) => ipcRenderer.invoke('routine:delete', specId),
  runRoutineNow: (specId) => ipcRenderer.invoke('routine:run-now', specId),
  updateRoutineCron: (specId, cronExpr) => ipcRenderer.invoke('routine:update-cron', specId, cronExpr),
  getRoutineHistory: (specId, limit) => ipcRenderer.invoke('routine:history', specId, limit),

  // Memory
  searchMemory: (query, limit) => ipcRenderer.invoke('memory:search', query, limit),
  getMemoryFacts: () => ipcRenderer.invoke('memory:facts'),

  // Notifications
  sendNotification: (title, body) => ipcRenderer.invoke('notification:send', title, body),

  // Sensors
  toggleSensor: (sensorId, enabled) => ipcRenderer.invoke('sensor:toggle', sensorId, enabled),
  getSensorStatuses: () => ipcRenderer.invoke('sensor:status'),
  onClipboardUpdated: (callback) => {
    ipcRenderer.removeAllListeners('sensor:clipboard-updated');
    ipcRenderer.on('sensor:clipboard-updated', (_, data) => callback(data));
  },

  // Screen Memory
  searchScreenMemory: (query, limit) => ipcRenderer.invoke('screen-memory:search', query, limit),

  // Accessibility
  readAccessibilityTree: () => ipcRenderer.invoke('accessibility:read-tree'),

  // App Settings
  getAppSetting: (key) => ipcRenderer.invoke('app-settings:get', key),
  setAppSetting: (key, value) => ipcRenderer.invoke('app-settings:set', key, value),
  listThinkingLevels: (model) => ipcRenderer.invoke('thinking:list-levels', model),
  cleanupNow: () => ipcRenderer.invoke('settings:cleanup-now'),
  onAppSettingChanged: (callback: (data: { key: string; value: string }) => void) => {
    ipcRenderer.removeAllListeners('app-settings:changed');
    ipcRenderer.on('app-settings:changed', (_, data) => callback(data));
  },

  // Proactivity Level
  getProactivityLevel: () => ipcRenderer.invoke('proactivity:get-level'),
  setProactivityLevel: (level) => ipcRenderer.invoke('proactivity:set-level', level),
  getProactivityTimings: () => ipcRenderer.invoke('proactivity:get-timings'),
  setProactivityTiming: (level, intervalMs, cooldownMs) => ipcRenderer.invoke('proactivity:set-timing', level, intervalMs, cooldownMs),

  // Audio Sensor / Meeting Memory
  getDesktopSources: () => ipcRenderer.invoke('desktop:get-sources'),
  processMeetingAudio: (audioBuffer, mimeType) => ipcRenderer.invoke('audio:process-meeting', audioBuffer, mimeType),
  processTranscriptText: (transcript) => ipcRenderer.invoke('audio:process-transcript', transcript),
  processHybridLocal: (audioBuffer, mimeType) => ipcRenderer.invoke('audio:process-hybrid', audioBuffer, mimeType),
  searchMeetingMemory: (query, limit) => ipcRenderer.invoke('meeting-memory:search', query, limit),

  // Meetings list & details
  listMeetings: (limit, offset) => ipcRenderer.invoke('meetings:list', limit, offset),
  getMeetingDetails: (meetingId) => ipcRenderer.invoke('meetings:get-details', meetingId),
  getMeetingContext: (meetingId) => ipcRenderer.invoke('meetings:get-context', meetingId),
  deleteMeeting: (meetingId) => ipcRenderer.invoke('meetings:delete', meetingId),

  // Communication Digests
  generateDigest: (date) => ipcRenderer.invoke('digest:generate', date),
  listDigests: (limit) => ipcRenderer.invoke('digest:list', limit),
  getDigestDetails: (digestId) => ipcRenderer.invoke('digest:get-details', digestId),
  getDigestByDate: (date) => ipcRenderer.invoke('digest:get-by-date', date),
  deleteDigest: (digestId) => ipcRenderer.invoke('digest:delete', digestId),
  onDigestProgress: (callback) => {
    ipcRenderer.removeAllListeners('digest:progress');
    ipcRenderer.on('digest:progress', (_, step) => callback(step));
  },
  onDigestComplete: (callback) => {
    ipcRenderer.removeAllListeners('digest:complete');
    ipcRenderer.on('digest:complete', (_, data) => callback(data));
  },
  onDigestError: (callback) => {
    ipcRenderer.removeAllListeners('digest:error');
    ipcRenderer.on('digest:error', (_, data) => callback(data));
  },

  // Audio Routing (system audio capture via RedBus Audio Bridge)
  checkAudioDriver: () => ipcRenderer.invoke('audio-routing:check-driver'),
  startAudioRouting: () => ipcRenderer.invoke('audio-routing:start'),
  stopAudioRouting: () => ipcRenderer.invoke('audio-routing:stop'),
  setupAudioRouting: () => ipcRenderer.invoke('audio-routing:setup'),
  reactivateAudioRouting: () => ipcRenderer.invoke('audio-routing:reactivate'),
  openSoundSettings: () => ipcRenderer.invoke('audio-routing:open-sound-settings'),
  listOutputDevices: () => ipcRenderer.invoke('audio-routing:list-output-devices'),
  createAggregate: (outputUID: string) => ipcRenderer.invoke('audio-routing:create-aggregate', outputUID),
  destroyAggregate: (aggregateID: number) => ipcRenderer.invoke('audio-routing:destroy-aggregate', aggregateID),
  getAudioStrategy: () => ipcRenderer.invoke('audio-routing:get-strategy'),
  getLinuxMonitorSource: () => ipcRenderer.invoke('audio-routing:linux-monitor-source'),
  onAudioOutputChanged: (callback: (data: { uid: string; name: string }) => void) => {
    ipcRenderer.on('audio-routing:output-changed', (_event, data) => callback(data));
  },

  // tl;dv Sensor
  forceTldvSync: () => ipcRenderer.invoke('tldv:force-sync'),
  getTldvSyncStatus: () => ipcRenderer.invoke('tldv:sync-status'),

  // Floating Widget
  openWidget: () => ipcRenderer.invoke('widget:open'),
  closeWidget: () => ipcRenderer.invoke('widget:close'),
  resizeWidget: (w: number, h: number) => ipcRenderer.invoke('widget:resize', w, h),

  // Window controls (Windows & Linux)
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  getWindowPlatform: () => ipcRenderer.invoke('window:get-platform'),
  widgetStartRecording: () => ipcRenderer.invoke('widget:start-recording'),
  widgetStopRecording: () => ipcRenderer.invoke('widget:stop-recording'),
  showMeetingReview: (data) => ipcRenderer.invoke('meeting:show-review', data),

  // Listeners: recording control (main → renderer)
  onRecordingStart: (callback) => {
    ipcRenderer.removeAllListeners('recording:start');
    ipcRenderer.on('recording:start', () => callback());
  },
  onRecordingStop: (callback) => {
    ipcRenderer.removeAllListeners('recording:stop');
    ipcRenderer.on('recording:stop', () => callback());
  },
  onMeetingReviewReady: (callback) => {
    ipcRenderer.removeAllListeners('meeting:review-ready');
    ipcRenderer.on('meeting:review-ready', (_, data) => callback(data));
  },
  onWidgetLoading: (callback) => {
    ipcRenderer.removeAllListeners('widget:loading');
    ipcRenderer.on('widget:loading', (_, loading) => callback(loading));
  },

  // Save reviewed meeting
  saveMeetingReview: (data) => ipcRenderer.invoke('meeting:save-review', data),

  // Proactive message listener (engine → chat)
  onProactiveMessage: (callback) => {
    ipcRenderer.removeAllListeners('chat:new-message');
    ipcRenderer.on('chat:new-message', (_, data) => callback(data));
  },

  // Activity Console
  getRecentActivityLogs: (limit?: number) => ipcRenderer.invoke('activity:get-recent-logs', limit),
  clearActivityLogs: () => ipcRenderer.invoke('activity:clear-logs'),
  onActivityLogEntry: (callback: (entry: any) => void) => {
    ipcRenderer.removeAllListeners('activity:log-entry');
    ipcRenderer.on('activity:log-entry', (_, entry) => callback(entry));
  },

  // Spec 11 — Communications Hub (Microsoft Graph)
  commsAuthStart: () => ipcRenderer.invoke('comms:auth-start'),
  commsAuthStatus: () => ipcRenderer.invoke('comms:auth-status'),
  commsAuthDisconnect: () => ipcRenderer.invoke('comms:auth-disconnect'),
  commsList: (filter?: { since?: string; until?: string; limit?: number; sources?: ('outlook' | 'teams')[] }) => ipcRenderer.invoke('comms:list', filter),
  commsRefresh: () => ipcRenderer.invoke('comms:refresh'),
  commsBackfillDate: (date: string) => ipcRenderer.invoke('comms:backfill-date', date),
  commsGenerateDigest: (payload: { date?: string; itemIds: string[] }) => ipcRenderer.invoke('comms:generate-digest', payload),
  commsListFilterPresets: () => ipcRenderer.invoke('comms:filter-presets'),
  commsSaveFilterPreset: (preset: any) => ipcRenderer.invoke('comms:filter-presets-save', preset),
  commsDeleteFilterPreset: (id: string) => ipcRenderer.invoke('comms:filter-presets-delete', id),
  onCommsNewItems: (callback: (data: { count: number; latestTimestamp: string }) => void) => {
    ipcRenderer.removeAllListeners('comms:new-items');
    ipcRenderer.on('comms:new-items', (_, data) => callback(data));
  },
  onCommsAuthStatus: (callback: (data: any) => void) => {
    ipcRenderer.removeAllListeners('comms:auth-status');
    ipcRenderer.on('comms:auth-status', (_, data) => callback(data));
  },
  onCommsBackfillProgress: (callback: (data: { date: string; stage: 'start' | 'outlook' | 'teams' | 'done'; status: 'running' | 'ok' | 'error'; count?: number; error?: string }) => void) => {
    ipcRenderer.removeAllListeners('comms:backfill-progress');
    ipcRenderer.on('comms:backfill-progress', (_, data) => callback(data));
  },

  // To-Do system
  createTodo: (payload: { content: string; target_date?: string | null }) => ipcRenderer.invoke('todo:create', payload),
  listTodos: (includeArchived?: boolean) => ipcRenderer.invoke('todo:list', includeArchived),
  completeTodo: (todoId: string) => ipcRenderer.invoke('todo:complete', todoId),
  archiveTodo: (todoId: string) => ipcRenderer.invoke('todo:archive', todoId),
  unarchiveTodo: (todoId: string) => ipcRenderer.invoke('todo:unarchive', todoId),
  deleteTodo: (todoId: string) => ipcRenderer.invoke('todo:delete', todoId),
  getTodo: (todoId: string) => ipcRenderer.invoke('todo:get', todoId),

  // Streaming events (real-time feedback during processing)
  onStreamEvent: (callback: (event: any) => void) => {
    ipcRenderer.removeAllListeners('stream:event');
    ipcRenderer.on('stream:event', (_, event) => callback(event));
  },
  removeStreamEventListener: () => {
    ipcRenderer.removeAllListeners('stream:event');
  },
};

// Padrão de segurança: Nenhuma API do Node.js é exposta renderizador
// O App envia apenas tarefas estruturadas
contextBridge.exposeInMainWorld('redbusAPI', api);
