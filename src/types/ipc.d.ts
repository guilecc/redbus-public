import type { RolesMap } from './roles';

export interface ProviderConfigs {
  id?: number;
  openAiKey?: string;
  anthropicKey?: string;
  googleKey?: string;
  ollamaUrl?: string;
  ollamaCloudKey?: string;
  ollamaCloudUrl?: string;
  roles?: RolesMap;
  updatedAt?: string;
}

export interface IpcResponse<T = any> {
  status: 'OK' | 'ERROR';
  data?: T;
  error?: string;
}

export interface RedBusAPI {
  sendTaskToOrchestrator: (specPayload: string) => Promise<string>;
  onMonitorStatus: () => Promise<string>;

  // Obtém todas as configurações estruturadas
  getProviderConfigs: () => Promise<IpcResponse<ProviderConfigs>>;

  // Perfil da Alma (User Profile)
  getUserProfile: () => Promise<IpcResponse<any>>;
  saveUserProfile: (profile: any) => Promise<IpcResponse<void>>;

  // Identidade profissional (usada no digest addressing)
  getProfessionalProfile: () => Promise<IpcResponse<{ professional_name: string; professional_email: string; professional_aliases: string[] }>>;
  saveProfessionalProfile: (payload: { professional_name: string; professional_email: string; professional_aliases: string[] }) => Promise<IpcResponse<void>>;

  // Salva Múltiplos
  saveProviderConfigs: (configs: ProviderConfigs) => Promise<IpcResponse<void>>;

  // Salva unitário (provider specífico conforme especificado nas regras da API)
  saveProviderConfig: (provider: 'openai' | 'anthropic' | 'google' | 'ollama-cloud', apiKey: string, defaultModel?: string) => Promise<IpcResponse<void>>;

  // Testa o Worker isolado em um BrowserView
  runWorkerTest: (url: string, instruction: string) => Promise<IpcResponse<string>>;

  // Maestro
  createSpecFromPrompt: (prompt: string | any[], filePaths?: string[]) => Promise<IpcResponse<any>>;
  selectFiles: () => Promise<IpcResponse<string[]>>;

  // Smart Browser View Controls
  showBrowserView: (viewId: string) => Promise<IpcResponse<void>>;
  hideBrowserView: (viewId: string) => Promise<IpcResponse<void>>;
  resumeViewExtraction: (viewId: string) => Promise<IpcResponse<void>>;
  resumeAuth: (viewId: string) => Promise<IpcResponse<void>>;
  respondToConsent: (requestId: string, approved: boolean) => Promise<IpcResponse<void>>;
  abortAgentRun: (sessionId: string) => Promise<IpcResponse<void>>;
  listActiveAgentRuns: () => Promise<IpcResponse<{ runs: Array<{ runId: string; sessionId: string; startedAt: number }> }>>;

  // Listeners
  onAuthRequired: (callback: (data: { viewId: string, url: string, bounds?: { x: number, y: number, width: number, height: number } }) => void) => void;
  onAuthCompleted: (callback: (data: { viewId: string }) => void) => void;
  onWorkerStepUpdate: (callback: (data: { specId: string, stepIndex: number, status: string, data?: any, error?: string, conversationalReply?: string }) => void) => void;
  onHitlConsentRequest: (callback: (data: { requestId: string, reason: string, action: string }) => void) => void;

  // Dynamic Provider Configs
  fetchAvailableModels: (provider: 'openai' | 'anthropic' | 'google' | 'ollama-cloud', apiKey: string, customUrl?: string) => Promise<IpcResponse<{ id: string; name: string }[]>>;

  // Ollama
  getOllamaStatus: (url?: string) => Promise<IpcResponse<boolean>>;
  listOllamaModels: (url?: string) => Promise<IpcResponse<{ name: string, model: string, modified_at: string, size: number, digest: string, details: any }[]>>;
  pullOllamaModel: (modelTag: string, url?: string) => Promise<IpcResponse<void>>;
  onOllamaPullProgress: (callback: (data: { model: string, status: string, completed?: number, total?: number, error?: string }) => void) => void;

  // Execution
  executeSpec: (specId: string) => Promise<IpcResponse<void>>;
  executeSkillTask: (specId: string) => Promise<IpcResponse<void>>;

  // Session / Archive
  saveMessage: (msg: { id: string; role: string; content: string; type?: string; specData?: string }) => Promise<IpcResponse<void>>;
  getMessages: (limit: number, offset: number) => Promise<IpcResponse<any[]>>;
  getArchives: () => Promise<IpcResponse<{ filename: string; filepath: string; sizeBytes: number; label: string }[]>>;
  deleteArchive: (filename: string) => Promise<IpcResponse<void>>;

  // Factory Reset
  factoryReset: () => Promise<IpcResponse<void>>;

  // Onboarding / Setup (Spec 08)
  getSetupStatus: () => Promise<IpcResponse<SetupStatus>>;
  markSetupComplete: () => Promise<IpcResponse<void>>;
  resetSetup: () => Promise<IpcResponse<void>>;
  recommendRoles: (availableByProvider: Record<string, string[]>) => Promise<IpcResponse<RolesMap>>;

  // Secure Vault
  saveVaultSecret: (id: string, serviceName: string, token: string) => Promise<IpcResponse<void>>;
  listVaultSecrets: () => Promise<IpcResponse<{ id: string; service_name: string; createdAt?: string }[]>>;
  deleteVaultSecret: (id: string) => Promise<IpcResponse<void>>;

  // Skill Library
  listSkills: () => Promise<IpcResponse<SkillEntry[]>>;
  getSkill: (name: string) => Promise<IpcResponse<SkillDetail>>;
  updateSkill: (skill: { name: string; description: string; body: string; metadata?: any; homepage?: string }) => Promise<IpcResponse<void>>;
  deleteSkill: (name: string) => Promise<IpcResponse<void>>;

  // Routines
  listRoutines: () => Promise<IpcResponse<RoutineEntry[]>>;
  pauseRoutine: (specId: string) => Promise<IpcResponse<void>>;
  resumeRoutine: (specId: string) => Promise<IpcResponse<void>>;
  deleteRoutine: (specId: string) => Promise<IpcResponse<void>>;
  runRoutineNow: (specId: string) => Promise<IpcResponse<{ status: string; summary?: string; error?: string }>>;
  updateRoutineCron: (specId: string, cronExpr: string) => Promise<IpcResponse<void>>;
  getRoutineHistory: (specId: string, limit?: number) => Promise<IpcResponse<RoutineExecution[]>>;

  // Memory
  searchMemory: (query: string, limit?: number) => Promise<IpcResponse<MemorySearchResult[]>>;
  getMemoryFacts: () => Promise<IpcResponse<MemoryFact[]>>;

  // Notifications
  sendNotification: (title: string, body: string) => Promise<IpcResponse<void>>;

  // Sensors
  toggleSensor: (sensorId: string, enabled: boolean) => Promise<IpcResponse<void>>;
  getSensorStatuses: () => Promise<IpcResponse<SensorStatus[]>>;
  onClipboardUpdated: (callback: (data: { text: string; capturedAt: string }) => void) => void;

  // Screen Memory
  searchScreenMemory: (query: string, limit?: number) => Promise<IpcResponse<ScreenMemoryResult[]>>;

  // Accessibility
  readAccessibilityTree: () => Promise<IpcResponse<AccessibilityTreeResponse>>;

  // App Settings
  getAppSetting: (key: string) => Promise<IpcResponse<string | null>>;
  setAppSetting: (key: string, value: string) => Promise<IpcResponse<void>>;
  listThinkingLevels: (model: string) => Promise<IpcResponse<{ supported: string[]; default: string; providerId: string | null }>>;
  cleanupNow: () => Promise<IpcResponse<{ deleted: number }>>;
  onAppSettingChanged: (callback: (data: { key: string; value: string }) => void) => void;

  // Proactivity Level
  getProactivityLevel: () => Promise<IpcResponse<'OFF' | 'LOW' | 'MEDIUM' | 'HIGH'>>;
  setProactivityLevel: (level: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH') => Promise<IpcResponse<void>>;
  getProactivityTimings: () => Promise<IpcResponse<Record<string, { intervalMs: number; cooldownMs: number }>>>;
  setProactivityTiming: (level: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH', intervalMs?: number, cooldownMs?: number) => Promise<IpcResponse<void>>;

  // Audio Sensor / Meeting Memory
  getDesktopSources: () => Promise<IpcResponse<{ id: string; name: string; type: 'screen' | 'window' }[]>>;
  processMeetingAudio: (audioBuffer: ArrayBuffer, mimeType: string) => Promise<IpcResponse<{ summary: any; raw_transcript?: string; provider_used?: string }>>;
  processTranscriptText: (transcript: string) => Promise<IpcResponse<{ summary: any; raw_transcript?: string; provider_used?: string }>>;
  processHybridLocal: (audioBuffer: ArrayBuffer, mimeType: string) => Promise<IpcResponse<{ summary: any; raw_transcript?: string; provider_used?: string }>>;
  searchMeetingMemory: (query: string, limit?: number) => Promise<IpcResponse<any[]>>;

  // Meetings list & details
  listMeetings: (limit?: number, offset?: number) => Promise<IpcResponse<any[]>>;
  getMeetingDetails: (meetingId: string) => Promise<IpcResponse<any>>;
  getMeetingContext: (meetingId: string) => Promise<IpcResponse<string>>;
  deleteMeeting: (meetingId: string) => Promise<IpcResponse<{ deleted: boolean }>>;

  // Communication Digests
  generateDigest: (date?: string) => Promise<IpcResponse<{ started: boolean; date: string }>>;
  listDigests: (limit?: number) => Promise<IpcResponse<any[]>>;
  getDigestDetails: (digestId: string) => Promise<IpcResponse<any>>;
  getDigestByDate: (date: string) => Promise<IpcResponse<any>>;
  deleteDigest: (digestId: string) => Promise<IpcResponse<{ deleted: boolean }>>;
  onDigestProgress: (callback: (step: string) => void) => void;
  onDigestComplete: (callback: (data: { date: string; id: string; summary: any }) => void) => void;
  onDigestError: (callback: (data: { date: string; error: string }) => void) => void;


  // Audio Routing (system audio capture via RedBus Audio Bridge)
  checkAudioDriver: () => Promise<IpcResponse<{ driverInstalled: boolean; redbusUID: string | null; redbusName: string | null; needsSetup: boolean; setupInstructions: string | null }>>;
  startAudioRouting: () => Promise<IpcResponse<any>>;
  stopAudioRouting: () => Promise<IpcResponse<void>>;
  setupAudioRouting: () => Promise<IpcResponse<any>>;
  reactivateAudioRouting: () => Promise<IpcResponse<void>>;
  openSoundSettings: () => Promise<IpcResponse<void>>;
  onAudioOutputChanged: (callback: (data: { uid: string; name: string }) => void) => void;
  listOutputDevices: () => Promise<IpcResponse<Array<{ id: number; name: string; uid: string; hasOutput: boolean; hasInput: boolean }>>>;
  createAggregate: (outputUID: string) => Promise<IpcResponse<{ aggregateID: number; aggregateUID: string; aggregateName: string; redbusUID: string }>>;
  destroyAggregate: (aggregateID: number) => Promise<IpcResponse<void>>;
  getAudioStrategy: () => Promise<IpcResponse<{ platform: string; method: string; requiresSetup: boolean; nativeCapture: boolean; description: string }>>;
  getLinuxMonitorSource: () => Promise<IpcResponse<string | null>>;

  // tl;dv Sensor
  forceTldvSync: () => Promise<IpcResponse<{ success: boolean; syncedAt: string; newMeetings: number; error?: string }>>;
  getTldvSyncStatus: () => Promise<IpcResponse<{ enabled: boolean; syncing: boolean; lastResult: any; hasApiKey: boolean }>>;

  // Floating Widget
  openWidget: () => Promise<IpcResponse<void>>;
  closeWidget: () => Promise<IpcResponse<void>>;
  resizeWidget: (w: number, h: number) => Promise<IpcResponse<void>>;
  widgetStartRecording: () => Promise<IpcResponse<void>>;
  widgetStopRecording: () => Promise<IpcResponse<void>>;
  showMeetingReview: (data: MeetingReviewData) => Promise<IpcResponse<void>>;

  // Window controls (Windows & Linux only)
  minimizeWindow: () => Promise<IpcResponse<void>>;
  maximizeWindow: () => Promise<IpcResponse<void>>;
  closeWindow: () => Promise<IpcResponse<void>>;
  isWindowMaximized: () => Promise<IpcResponse<boolean>>;
  getWindowPlatform: () => Promise<IpcResponse<string>>;

  // Listeners: recording control (main → renderer)
  onRecordingStart: (callback: () => void) => void;
  onRecordingStop: (callback: () => void) => void;
  onMeetingReviewReady: (callback: (data: MeetingReviewData | { meetingId: string }) => void) => void;
  onWidgetLoading: (callback: (loading: boolean) => void) => void;

  // Save reviewed meeting (after user edits in review screen)
  saveMeetingReview: (data: { raw_transcript: string; summary_json: any; provider_used: string }) => Promise<IpcResponse<{ meetingId: string }>>;

  // Proactive message listener
  onProactiveMessage: (callback: (data: { id: string; role: string; content: string; type?: string }) => void) => void;

  // Activity Console
  getRecentActivityLogs: (limit?: number) => Promise<IpcResponse<ActivityLogEntry[]>>;
  clearActivityLogs: () => Promise<IpcResponse<void>>;
  onActivityLogEntry: (callback: (entry: ActivityLogEntry) => void) => void;

  // Spec 11 — Communications Hub (Microsoft Graph)
  commsAuthStart: () => Promise<IpcResponse<{ userCode: string; verificationUri: string; expiresIn: number; interval: number; message?: string }>>;
  commsAuthStatus: () => Promise<IpcResponse<CommsAuthStatus>>;
  commsAuthDisconnect: () => Promise<IpcResponse<void>>;
  commsList: (filter?: { since?: string; until?: string; limit?: number; sources?: ('outlook' | 'teams')[] }) => Promise<IpcResponse<CommunicationItem[]>>;
  commsRefresh: () => Promise<IpcResponse<{ ingested: number }>>;
  commsBackfillDate: (date: string) => Promise<IpcResponse<{ ingested: number; date: string }>>;
  commsGenerateDigest: (payload: { date?: string; itemIds: string[] }) => Promise<IpcResponse<{ started: boolean; date: string; count: number }>>;
  commsListFilterPresets: () => Promise<IpcResponse<CommsFilterPreset[]>>;
  commsSaveFilterPreset: (preset: CommsFilterPreset) => Promise<IpcResponse<CommsFilterPreset[]>>;
  commsDeleteFilterPreset: (id: string) => Promise<IpcResponse<CommsFilterPreset[]>>;
  onCommsNewItems: (callback: (data: { count: number; latestTimestamp: string }) => void) => void;
  onCommsAuthStatus: (callback: (data: CommsAuthStatus & { completed?: boolean }) => void) => void;
  onCommsBackfillProgress: (callback: (data: { date: string; stage: 'start' | 'outlook' | 'teams' | 'done'; status: 'running' | 'ok' | 'error'; count?: number; error?: string }) => void) => void;

  // To-Do system
  createTodo: (payload: { content: string; target_date?: string | null }) => Promise<IpcResponse<TodoItem>>;
  listTodos: (includeArchived?: boolean) => Promise<IpcResponse<TodoItem[]>>;
  completeTodo: (todoId: string) => Promise<IpcResponse<{ completed: boolean }>>;
  archiveTodo: (todoId: string) => Promise<IpcResponse<{ archived: boolean }>>;
  unarchiveTodo: (todoId: string) => Promise<IpcResponse<{ unarchived: boolean }>>;
  deleteTodo: (todoId: string) => Promise<IpcResponse<{ deleted: boolean }>>;
  getTodo: (todoId: string) => Promise<IpcResponse<TodoItem>>;

  // Streaming events
  onStreamEvent: (callback: (event: StreamEvent) => void) => void;
  removeStreamEventListener: () => void;
}

interface SetupStatus {
  completed: boolean;
  completedAt: string | null;
  hasAnyKey: boolean;
  allRolesConfigured: boolean;
  rolesConfigured: {
    planner: boolean;
    executor: boolean;
    synthesizer: boolean;
    utility: boolean;
  };
}

interface MeetingReviewData {
  raw_transcript: string;
  summary_json: {
    executive_summary: string;
    decisions: string[];
    action_items: { owner: string; task: string; deadline?: string | null }[];
    participants?: string[];
    duration_estimate?: string;
  };
  provider_used: string;
}

interface RoutineEntry {
  id: string;
  goal: string;
  cron_expression: string;
  enabled: boolean;
  status: string;
  next_run_at: string | null;
  last_run: string | null;
  last_error: string | null;
  consecutive_errors: number;
  last_duration_ms: number | null;
  timezone: string;
  skill_name: string | null;
  skill_task: boolean;
  steps: Array<{ url: string; instruction: string }>;
}

interface RoutineExecution {
  id: string;
  specId: string;
  startedAt: string;
  endedAt: string | null;
  status: 'running' | 'ok' | 'error' | 'skipped';
  error: string | null;
  summary: string | null;
  durationMs: number | null;
}

interface MemorySearchResult {
  id: string;
  content: string;
  role: string;
  source: 'message' | 'fact';
  category?: string;
  createdAt: string;
  snippet: string;
}

interface MemoryFact {
  id: string;
  category: string;
  content: string;
}

interface SensorStatus {
  id: string;
  label: string;
  enabled: boolean;
}

interface ScreenMemoryResult {
  id: number;
  timestamp: string;
  activeApp: string;
  activeTitle: string;
  snippet: string;
}

interface ActivityLogEntry {
  id: string;
  timestamp: string;
  category: 'sensors' | 'meetings' | 'routines' | 'proactivity' | 'orchestrator';
  message: string;
  metadata?: any;
}

interface AccessibilityTreeResponse {
  appName?: string;
  windowTitle?: string;
  tree: any[];
  nodeCount: number;
  textSummary: string;
}

interface TodoItem {
  id: string;
  content: string;
  target_date: string | null;
  status: 'pending' | 'completed';
  archived: number;
  created_at: string;
}

// ── Streaming Events ──
export type StreamEventType =
  | 'thinking-start' | 'thinking-chunk' | 'thinking-end'
  | 'tool-start' | 'tool-end'
  | 'response-start' | 'response-chunk' | 'response-end'
  | 'worker-start' | 'worker-end'
  | 'pipeline-start' | 'pipeline-end'
  | 'error';

export interface StreamEvent {
  requestId: string;
  type: StreamEventType;
  chunk?: string;
  toolName?: string;
  toolLabel?: string;
  toolIcon?: string;
  durationMs?: number;
  accumulated?: string;
  error?: string;
  ts: number;
}

// Spec 11 — Communications Hub data contracts
export interface CommunicationItem {
  id: string;
  graphId: string;
  source: 'outlook' | 'teams';
  sender: string;
  senderEmail?: string;
  threadId?: string;
  groupId?: string;
  subject?: string;
  channelOrChatName?: string;
  plainText: string;
  timestamp: string;
  isUnread: boolean;
  webLink?: string;
  importance?: 'low' | 'normal' | 'high';
  mentionsMe?: boolean;
}

export interface CommsAuthStatus {
  connected: boolean;
  upn?: string;
  displayName?: string;
  expiresAt?: string;
}

export interface CommsFilterPreset {
  id: string;
  name: string;
  blacklist: string[];
  whitelist: string[];
  sources: { outlook: boolean; teams: boolean };
  unreadOnly: boolean;
  sameDomainOnly?: boolean;
  // When true, this preset is auto-applied whenever the Communications Hub
  // mounts. Only a single preset can hold the default flag at any given time
  // (backend enforces this on save).
  isDefault?: boolean;
}

declare global {
  interface Window {
    redbusAPI: RedBusAPI;
  }
  interface SkillEntry {
    name: string;
    description: string;
    dir: string;
    emoji: string | null;
    requires_env: string[];
    requires_bins: string[];
    homepage: string | null;
    mtimeMs: number;
  }
  interface SkillDetail {
    name: string;
    description: string;
    body: string;
    dir: string;
    bodyPath: string;
    frontmatter: {
      name: string;
      description: string;
      homepage?: string;
      metadata?: {
        emoji?: string;
        requires?: { env?: string[]; bins?: string[]; anyBins?: string[] };
        primaryEnv?: string;
        install?: Array<Record<string, any>>;
      };
    };
    scripts: string[];
    references: string[];
    assets: string[];
  }
}
