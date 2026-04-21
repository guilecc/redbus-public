import { useEffect, useState } from 'react';
import { useTranslation } from './i18n/index.js';
import { MessageList } from './components/Chat/MessageList';
import { ChatInput } from './components/Chat/ChatInput';
import { Message } from './components/Chat/MessageBubble';
import { TitleBar } from './components/Layout/TitleBar';
import { SkillManager } from './components/Settings/SkillManager';
import { RoutineManager } from './components/Routines/RoutineManager';
import { WidgetOverlay } from './components/Widget/WidgetOverlay';
import { MeetingReview } from './components/Meeting/MeetingReview';
import { MeetingsView } from './components/Meetings/MeetingsView';
import { ActivityConsole } from './components/ActivityConsole/ActivityConsole';
import { CommunicationHub } from './components/Comms/CommunicationHub';
import { TodoManager } from './components/Todos/TodoManager';
import { HistoryView } from './components/History/HistoryView';
import { useStreamingResponse } from './hooks/useStreamingResponse';
import { OllamaSettings } from './components/Settings/OllamaSettings';
import { RolePicker } from './components/Settings/RolePicker';
import { OnboardingShell } from './components/Onboarding/OnboardingShell';
import { DEFAULT_ROLES, ROLE_NAMES, REQUIRED_ROLE_NAMES, type RoleBinding, type RoleName, type RolesMap } from './types/roles';
import { v4 as uuidv4 } from 'uuid';
import { Loader2, CheckCircle2, XCircle, BrainCircuit, ShieldCheck, Mic, Zap, Settings, Cloud, ShieldEllipsis, Volume2, Globe, MessagesSquare } from 'lucide-react';

// ── Digest curation — mirrors electron/services/digestService DigestCurationConfig ──
// Kept inline to avoid pulling an electron-only module into the renderer bundle.
interface DigestCurationConfig {
  dropAcks: boolean;
  minLength: number;
  signalLength: number;
  neutralCapPerThread: number;
  alwaysKeepFirst: boolean;
  alwaysKeepLast: boolean;
  customAckPatterns: string[];
}
const DEFAULT_DIGEST_CURATION: DigestCurationConfig = {
  dropAcks: true,
  minLength: 10,
  signalLength: 200,
  neutralCapPerThread: 2,
  alwaysKeepFirst: true,
  alwaysKeepLast: true,
  customAckPatterns: [],
};

type ProviderStatus = 'idle' | 'loading' | 'valid' | 'invalid';
interface ModelOpt { id: string; name: string }
interface ArchiveFile { filename: string; filepath: string; sizeBytes: number; label: string; }

// ── Hash routing: widget window renders a minimal overlay ──
const IS_WIDGET = window.location.hash.includes('/widget');

export default function App() {
  if (IS_WIDGET) return <WidgetOverlay />;
  const { t, setLang } = useTranslation();
  const [keys, setKeys] = useState({
    openAiKey: '',
    anthropicKey: '',
    googleKey: '',
    ollamaUrl: 'http://localhost:11434',
    ollamaCloudKey: '',
    ollamaCloudUrl: 'https://ollama.com'
  });
  const [roles, setRoles] = useState<RolesMap>(DEFAULT_ROLES);
  const [rolesMode, setRolesMode] = useState<'simple' | 'advanced'>('simple');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeView, setActiveView] = useState('chat');
  const [settingsTab, setSettingsTab] = useState<'llm' | 'vault' | 'audio' | 'proactivity' | 'digest' | 'system'>('llm');
  const [profileExists, setProfileExists] = useState<boolean | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const streaming = useStreamingResponse();
  const [authRequiredView, setAuthRequiredView] = useState<{ viewId: string, url: string, bounds?: { x: number, y: number, width: number, height: number } } | null>(null);
  const [hitlConsent, setHitlConsent] = useState<{ requestId: string, reason: string, action: string } | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);

  // Language settings — defaults to English; user can change during onboarding or in Settings
  const [appLanguage, setAppLanguage] = useState<'en' | 'pt-BR'>('en');
  const [showLangWarning, setShowLangWarning] = useState(false);
  const [pendingLang, setPendingLang] = useState<'en' | 'pt-BR' | null>(null);

  const [vaultSecrets, setVaultSecrets] = useState<{ id: string; service_name: string }[]>([]);
  const [newVaultService, setNewVaultService] = useState('');
  const [newVaultToken, setNewVaultToken] = useState('');
  const [assistantName, setAssistantName] = useState<string>('');
  const [userName, setUserName] = useState<string>('');

  const [apiStatus, setApiStatus] = useState<Record<string, ProviderStatus>>({ openai: 'idle', anthropic: 'idle', google: 'idle', ollamaCloud: 'idle' });
  const [availableModels, setAvailableModels] = useState<Record<string, ModelOpt[]>>({ openai: [], anthropic: [], google: [], ollamaCloud: [] });

  // Proactivity Settings
  type ProactivityLevel = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
  const PROACTIVITY_LEVELS: ProactivityLevel[] = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];
  const [proactivityLevel, setProactivityLevel] = useState<ProactivityLevel>('MEDIUM');
  const [proactivityTimings, setProactivityTimings] = useState<Record<string, { intervalMs: number; cooldownMs: number }>>({});
  const [proactivityTimingsLoaded, setProactivityTimingsLoaded] = useState(false);
  const [transcriptionEngine, setTranscriptionEngine] = useState<'gemini' | 'whisper' | 'local'>('gemini');
  const [transcriptionMode, setTranscriptionMode] = useState<'FULL_CLOUD' | 'HYBRID_LOCAL'>('FULL_CLOUD');

  // Digest curation — persisted in AppSettings under `comms.digest.curation`.
  const [digestCuration, setDigestCuration] = useState<DigestCurationConfig>(DEFAULT_DIGEST_CURATION);
  const [digestCurationLoaded, setDigestCurationLoaded] = useState(false);
  const [digestSaveStatus, setDigestSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  // Raw text draft for the custom-ack input so commas/spaces are not stripped
  // on every keystroke (array parse happens only on save / blur / reset).
  const [customAckDraft, setCustomAckDraft] = useState<string>('');

  // Audio device selection
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('');
  const [selectedSystemId, setSelectedSystemId] = useState<string>('');
  const isMac = navigator.userAgent.includes('Mac');

  // Activity Console
  const [activityConsoleOpen, setActivityConsoleOpen] = useState(false);

  // Meeting review (Ata Viva) — kept for backward compat but no longer used in recording flow
  const [meetingReviewData, setMeetingReviewData] = useState<{
    raw_transcript: string;
    summary_json: any;
    provider_used: string;
  } | null>(null);

  // ID of a meeting to auto-select when navigating to MeetingsView
  const [initialMeetingId, setInitialMeetingId] = useState<string | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  const validateKey = async (provider: 'openai' | 'anthropic' | 'google' | 'ollama-cloud', key: string) => {
    if (!key) return;
    const statusKey = provider === 'ollama-cloud' ? 'ollamaCloud' : provider;
    setApiStatus(prev => ({ ...prev, [statusKey]: 'loading' }));
    try {
      if (window.redbusAPI) {
        const customUrl = provider === 'ollama-cloud' ? keys.ollamaCloudUrl : undefined;
        const response = await window.redbusAPI.fetchAvailableModels(provider, key, customUrl);
        if (response.status === 'OK' && response.data) {
          setAvailableModels(prev => ({ ...prev, [statusKey]: response.data as ModelOpt[] }));
          setApiStatus(prev => ({ ...prev, [statusKey]: 'valid' }));
        } else {
          setApiStatus(prev => ({ ...prev, [statusKey]: 'invalid' }));
          setAvailableModels(prev => ({ ...prev, [statusKey]: [] }));
        }
      }
    } catch (e) {
      setApiStatus(prev => ({ ...prev, [statusKey]: 'invalid' }));
      setAvailableModels(prev => ({ ...prev, [statusKey]: [] }));
    }
  };

  useEffect(() => {
    async function fetchSettings() {
      if (window.redbusAPI) {
        // Setup flag gates the onboarding wizard; language preference is
        // independent and always honoured if the user picked one previously
        // (e.g. survives setup:reset).
        const setupRes = await window.redbusAPI.getSetupStatus();
        const alreadySetup = setupRes.status === 'OK' && !!setupRes.data && setupRes.data.completed && setupRes.data.allRolesConfigured;
        setSetupCompleted(alreadySetup);

        const langRes = await window.redbusAPI.getAppSetting('language');
        if (langRes.status === 'OK' && langRes.data) {
          const stored = langRes.data as 'en' | 'pt-BR';
          setAppLanguage(stored);
          setLang(stored);
        }

        const profileRes = await window.redbusAPI.getUserProfile();
        if (profileRes.status === 'OK' && profileRes.data && profileRes.data.id === 'default') {
          setProfileExists(true);
          setUserName(profileRes.data.name);
        } else {
          setProfileExists(false);
        }

        const nameRes = await window.redbusAPI.getAppSetting('assistant_name');
        if (nameRes.status === 'OK' && nameRes.data) setAssistantName(nameRes.data);

        const msgsRes = await window.redbusAPI.getMessages(200, 0);
        if (msgsRes.status === 'OK' && msgsRes.data && msgsRes.data.length > 0) {
          const loaded: Message[] = msgsRes.data
            .filter((m: any) => m.type !== 'thinking') // Safety: never show internal thinking
            .map((m: any) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              type: m.type as any,
              specData: m.specData ? JSON.parse(m.specData) : undefined
            }));
          setMessages(loaded);
        } else if (profileExists === false) {
          // If no history and no profile, welcome will be set by the lang effect
        }

        const response = await window.redbusAPI.getProviderConfigs();
        if (response.status === 'OK' && response.data) {
          const { openAiKey, anthropicKey, googleKey, ollamaUrl, ollamaCloudKey, ollamaCloudUrl, roles: loadedRoles } = response.data;
          setKeys({
            openAiKey: openAiKey || '',
            anthropicKey: anthropicKey || '',
            googleKey: googleKey || '',
            ollamaUrl: ollamaUrl || 'http://localhost:11434',
            ollamaCloudKey: ollamaCloudKey || '',
            ollamaCloudUrl: ollamaCloudUrl || 'https://ollama.com',
          });
          if (loadedRoles) {
            const merged: RolesMap = { ...DEFAULT_ROLES, ...loadedRoles } as RolesMap;
            setRoles(merged);
            const firstModel = merged.planner?.model;
            // `digest` is an optional role — excluding it keeps upgrading users
            // in simple mode when they haven't picked a dedicated digest model yet.
            const allSame = firstModel && REQUIRED_ROLE_NAMES.every(r => merged[r]?.model === firstModel);
            setRolesMode(allSame ? 'simple' : 'advanced');
          }
          if (openAiKey) validateKey('openai', openAiKey);
          if (anthropicKey) validateKey('anthropic', anthropicKey);
          if (googleKey) validateKey('google', googleKey);
          if (ollamaCloudKey) validateKey('ollama-cloud', ollamaCloudKey);

          if (ollamaUrl) {
            const list = await window.redbusAPI.listOllamaModels(ollamaUrl);
            if (list?.status === 'OK' && list.data) {
              setOllamaModels(list.data.map((m: any) => m.name));
            }
          }
        }

        // Initial load of vault secrets
        const vaultRes = await window.redbusAPI.listVaultSecrets();
        if (vaultRes.status === 'OK' && vaultRes.data) setVaultSecrets(vaultRes.data);
      }
      setLoaded(true);
    }
    fetchSettings();

    if (window.redbusAPI?.onAuthRequired) {
      window.redbusAPI.onAuthRequired((data) => {
        setAuthRequiredView(data);
      });
    }

    // Auto-dismiss auth modal when login completes (BrowserView navigates away from auth URL)
    if (window.redbusAPI?.onAuthCompleted) {
      window.redbusAPI.onAuthCompleted(() => {
        setAuthRequiredView(null);
      });
    }

    if (window.redbusAPI?.onAppSettingChanged) {
      window.redbusAPI.onAppSettingChanged((data) => {
        if (data.key === 'assistant_name') {
          setAssistantName(data.value);
        }
      });
    }

    if (window.redbusAPI?.onWorkerStepUpdate) {
      window.redbusAPI.onWorkerStepUpdate((update) => {
        setMessages((prev) => {
          const newMsgs = prev.map((msg) => {
            if (msg.type === 'spec' && msg.id === update.specId) {
              const newSteps = [...(msg.specData?.steps || [])];
              if (newSteps[update.stepIndex]) {
                newSteps[update.stepIndex].status = update.status as 'running' | 'completed' | 'failed' | 'pending';
              }
              return {
                ...msg,
                specData: {
                  ...msg.specData,
                  goal: msg.specData?.goal || '',
                  steps: newSteps as { label: string, status: 'pending' | 'running' | 'completed' | 'failed' }[],
                  data: update.data,
                  error: update.error,
                  status: (update.status === 'completed' || update.status === 'failed' ? update.status : 'running') as 'running' | 'completed' | 'failed'
                }
              };
            }
            return msg;
          });
          if (update.conversationalReply) {
            // Use replyId from backend (already persisted server-side) to avoid duplication
            const replyId = (update as any).replyId || uuidv4();
            const replyMsg: Message = { id: replyId, role: 'assistant', content: update.conversationalReply };
            return [...newMsgs, replyMsg];
          }
          return newMsgs;
        });
      });
    }
    // HITL consent requests
    if (window.redbusAPI?.onHitlConsentRequest) {
      window.redbusAPI.onHitlConsentRequest((data) => {
        setHitlConsent(data);
      });
    }
    // Proactive messages from the engine (force or scheduled)
    if (window.redbusAPI?.onProactiveMessage) {
      window.redbusAPI.onProactiveMessage((data) => {
        setMessages(prev => [...prev, {
          id: data.id,
          role: data.role as 'user' | 'assistant',
          content: data.content,
          type: data.type as any,
        }]);
      });
    }

    // Meeting saved — navigate to meetings view with the new meeting selected
    if (window.redbusAPI?.onMeetingReviewReady) {
      window.redbusAPI.onMeetingReviewReady((data) => {
        if ('meetingId' in data && data.meetingId) {
          setInitialMeetingId(data.meetingId);
          setActiveView('meetings');
        } else if ('raw_transcript' in data) {
          // Fallback: old format (shouldn't happen anymore)
          setMeetingReviewData(data);
          setActiveView('meeting-review');
        }
      });
    }
  }, []);

  const handleConsentResponse = async (approved: boolean) => {
    if (hitlConsent && window.redbusAPI) {
      await window.redbusAPI.respondToConsent(hitlConsent.requestId, approved);
      setHitlConsent(null);
    }
  };

  const handleSendMessage = async (text: string, filePaths?: string[]) => {
    let msgContent = text;
    if (filePaths && filePaths.length > 0) {
      msgContent += `\n\n[Anexos: ${filePaths.map(p => p.split('/').pop() || p).join(', ')}]`;
    }

    const userMsg: Message = { id: uuidv4(), role: 'user', content: msgContent };
    setMessages(prev => [...prev, userMsg]);
    setIsProcessing(true);
    if (window.redbusAPI) {
      window.redbusAPI.saveMessage({ id: userMsg.id, role: userMsg.role, content: userMsg.content });
    }

    try {
      if (window.redbusAPI) {
        const historyContext = [...messages, userMsg].map(m => ({
          role: m.role as string,
          content: m.content as string
        }));

        const response = await window.redbusAPI.createSpecFromPrompt(historyContext, filePaths);

        if (response.status === 'OK') {
          if (response.data.status === 'ONBOARDING_CONTINUE' || response.data.status === 'ONBOARDING_COMPLETED') {
            const replyId = uuidv4();
            const replyContent = response.data.reply;
            setMessages(prev => [...prev, { id: replyId, role: 'assistant', content: replyContent }]);
            if (window.redbusAPI) window.redbusAPI.saveMessage({ id: replyId, role: 'assistant', content: replyContent });
            if (response.data.status === 'ONBOARDING_COMPLETED') {
              setProfileExists(true);
            }
          } else {
            const spec = response.data.parsedSpec || response.data;
            const specId = response.data.specId;
            const isSkillTask = response.data.skillTask === true;
            const skillName = response.data.skillName;

            // Check for conversational_reply (FORMAT F/G results from screen memory or accessibility)
            const conversationalReply = response.data.conversational_reply || spec.conversational_reply;

            if (conversationalReply) {
              // Use replyId from backend if already persisted (e.g. FORMAT M batch todos).
              // This avoids creating a duplicate ChatMessages row and ensures the next
              // turn has the correct context immediately.
              const backendReplyId: string | undefined = response.data.replyId;
              const textId = backendReplyId || uuidv4();
              setMessages(prev => [...prev, { id: textId, role: 'assistant', content: conversationalReply }]);
              // Only persist if the backend did NOT already save it
              if (!backendReplyId && window.redbusAPI) {
                window.redbusAPI.saveMessage({ id: textId, role: 'assistant', content: conversationalReply });
              }
            } else if (isSkillTask || (spec.steps && spec.steps.length > 0)) {
              const stepLabels = isSkillTask
                ? [{ label: skillName ? `skill → ${skillName}` : 'task → exec', status: 'pending' as const }]
                : spec.steps.map((s: any) => ({ label: `nav → ${s.url}`, status: 'pending' as const }));

              const specMsg: Message = {
                id: specId,
                role: 'assistant',
                content: '',
                type: 'spec',
                specData: {
                  goal: spec.goal || t.chat.taskStarted,
                  status: 'running',
                  steps: stepLabels
                }
              };
              setMessages(prev => [...prev, specMsg]);
              window.redbusAPI.saveMessage({
                id: specId, role: 'assistant', content: '',
                type: 'spec',
                specData: JSON.stringify(specMsg.specData)
              });

              if (!spec.cron_expression) {
                if (isSkillTask) {
                  window.redbusAPI.executeSkillTask(specId);
                } else {
                  window.redbusAPI.executeSpec(specId);
                }
              } else {
                const scheduledSpecData = { ...(specMsg.specData || { steps: [] }), goal: specMsg.specData?.goal || t.chat.taskScheduled, status: 'completed' as const };
                setMessages(prev => prev.map(m => m.id === specId ? {
                  ...m,
                  specData: scheduledSpecData,
                  content: `agendado: ${spec.cron_expression}`
                } as Message : m));
                // Persist scheduled spec
                window.redbusAPI.saveMessage({
                  id: specId, role: 'assistant', content: `agendado: ${spec.cron_expression}`,
                  type: 'spec',
                  specData: JSON.stringify(scheduledSpecData)
                });
              }
            } else {
              const textId = uuidv4();
              const textContent = spec.conversational_reply || spec.goal || '[Erro] Resposta vazia do modelo.';
              setMessages(prev => [...prev, { id: textId, role: 'assistant', content: textContent }]);
              if (window.redbusAPI) window.redbusAPI.saveMessage({ id: textId, role: 'assistant', content: textContent });
            }
          }
        } else {
          const errId = uuidv4();
          const errContent = `erro: ${response.error}`;
          setMessages(prev => [...prev, { id: errId, role: 'assistant', content: errContent }]);
          if (window.redbusAPI) window.redbusAPI.saveMessage({ id: errId, role: 'assistant', content: errContent });
        }
      }
    } catch (e) {
      const fatalId = uuidv4();
      const fatalContent = `erro fatal: ${String(e)}`;
      setMessages(prev => [...prev, { id: fatalId, role: 'assistant', content: fatalContent }]);
      if (window.redbusAPI) window.redbusAPI.saveMessage({ id: fatalId, role: 'assistant', content: fatalContent });
    }
    setIsProcessing(false);
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    if (window.redbusAPI) {
      await window.redbusAPI.saveProviderConfigs({ ...keys, roles });
    }
    setTimeout(() => setSaving(false), 500);
  };

  const handleAuthDone = async () => {
    if (authRequiredView && window.redbusAPI) {
      // Resolve the auth gate — hides BrowserView and lets the worker continue
      await window.redbusAPI.resumeAuth(authRequiredView.viewId);
      setAuthRequiredView(null);
    }
  };

  const handleChangeRole = async (role: RoleName, patch: Partial<RoleBinding>) => {
    const next: RolesMap = { ...roles, [role]: { ...roles[role], ...patch } };
    setRoles(next);
    setSaving(true);
    if (window.redbusAPI) {
      await window.redbusAPI.saveProviderConfigs({ ...keys, roles: next });
    }
    setTimeout(() => setSaving(false), 500);
  };

  const handleSetRoleModel = (role: RoleName, model: string) => {
    handleChangeRole(role, { model });
  };

  const handleSimpleModelChange = async (model: string) => {
    const next: RolesMap = ROLE_NAMES.reduce((acc, r) => {
      acc[r] = { ...roles[r], model };
      return acc;
    }, {} as RolesMap);
    setRoles(next);
    setSaving(true);
    if (window.redbusAPI) {
      await window.redbusAPI.saveProviderConfigs({ ...keys, roles: next });
    }
    setTimeout(() => setSaving(false), 500);
  };

  const handleCopyPlannerToAll = async () => {
    const plannerBinding = roles.planner;
    if (!plannerBinding?.model) return;
    const next: RolesMap = ROLE_NAMES.reduce((acc, r) => {
      acc[r] = { model: plannerBinding.model, thinkingLevel: plannerBinding.thinkingLevel, temperature: plannerBinding.temperature };
      return acc;
    }, {} as RolesMap);
    setRoles(next);
    setSaving(true);
    if (window.redbusAPI) {
      await window.redbusAPI.saveProviderConfigs({ ...keys, roles: next });
    }
    setTimeout(() => setSaving(false), 500);
  };

  const handleResetRoles = async () => {
    setRoles(DEFAULT_ROLES);
    setSaving(true);
    if (window.redbusAPI) {
      await window.redbusAPI.saveProviderConfigs({ ...keys, roles: DEFAULT_ROLES });
    }
    setTimeout(() => setSaving(false), 500);
  };

  const loadProactivitySettings = async () => {
    if (!window.redbusAPI) return;
    const levelRes = await window.redbusAPI.getProactivityLevel();
    if (levelRes.status === 'OK' && levelRes.data) setProactivityLevel(levelRes.data);
    const timingsRes = await window.redbusAPI.getProactivityTimings();
    if (timingsRes.status === 'OK' && timingsRes.data) {
      setProactivityTimings(timingsRes.data);
      setProactivityTimingsLoaded(true);
    }
    const engineRes = await window.redbusAPI.getAppSetting('transcription_engine');
    if (engineRes.status === 'OK' && engineRes.data) setTranscriptionEngine(engineRes.data as any);
    const modeRes = await window.redbusAPI.getAppSetting('transcription_mode');
    if (modeRes.status === 'OK' && modeRes.data) setTranscriptionMode(modeRes.data as any);

    // Load saved device IDs
    const micRes = await window.redbusAPI.getAppSetting('audio_mic_device_id');
    if (micRes.status === 'OK' && micRes.data) setSelectedMicId(micRes.data);
    const sysRes = await window.redbusAPI.getAppSetting('audio_system_device_id');
    if (sysRes.status === 'OK' && sysRes.data) setSelectedSystemId(sysRes.data);

    // Enumerate audio devices
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
    } catch (e) { console.warn('[Settings] Could not enumerate audio devices:', e); }
  };

  const loadVaultSecrets = async () => {
    if (!window.redbusAPI) return;
    const vaultRes = await window.redbusAPI.listVaultSecrets();
    if (vaultRes.status === 'OK' && vaultRes.data) setVaultSecrets(vaultRes.data);
  };

  const loadDigestCuration = async () => {
    if (!window.redbusAPI) return;
    const res = await window.redbusAPI.getAppSetting('comms.digest.curation');
    if (res.status === 'OK' && res.data) {
      try {
        const parsed = JSON.parse(res.data);
        const merged: DigestCurationConfig = { ...DEFAULT_DIGEST_CURATION, ...parsed };
        setDigestCuration(merged);
        setCustomAckDraft(merged.customAckPatterns.join(', '));
      } catch (e) { console.warn('[Settings] bad digest curation JSON:', e); }
    } else {
      setCustomAckDraft(DEFAULT_DIGEST_CURATION.customAckPatterns.join(', '));
    }
    setDigestCurationLoaded(true);
  };

  const parseAckDraft = (raw: string): string[] =>
    raw.split(',').map(s => s.trim()).filter(Boolean);

  const handleSaveDigestCuration = async () => {
    if (!window.redbusAPI) return;
    setDigestSaveStatus('saving');
    const toSave: DigestCurationConfig = { ...digestCuration, customAckPatterns: parseAckDraft(customAckDraft) };
    setDigestCuration(toSave);
    await window.redbusAPI.setAppSetting('comms.digest.curation', JSON.stringify(toSave));
    setDigestSaveStatus('saved');
    setTimeout(() => setDigestSaveStatus('idle'), 1500);
  };

  const handleViewChange = (view: string) => {
    setActiveView(view);
    if (view === 'settings' && !proactivityTimingsLoaded) loadProactivitySettings();
    if (view === 'settings') loadVaultSecrets();
    if (view === 'settings' && !digestCurationLoaded) loadDigestCuration();
  };

  const handleAddVaultSecret = async () => {
    if (!newVaultService.trim() || !newVaultToken.trim() || !window.redbusAPI) return;
    const id = newVaultService.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    await window.redbusAPI.saveVaultSecret(id, newVaultService.trim(), newVaultToken.trim());
    setVaultSecrets(prev => [...prev, { id, service_name: newVaultService.trim() }]);
    setNewVaultService('');
    setNewVaultToken('');
  };

  const handleDeleteVaultSecret = async (id: string) => {
    if (!window.redbusAPI) return;
    await window.redbusAPI.deleteVaultSecret(id);
    setVaultSecrets(prev => prev.filter(s => s.id !== id));
  };

  const handleFactoryReset = async () => {
    if (resetConfirmText !== t.modals.reset.confirmWord) return;
    setResetting(true);
    try {
      if (window.redbusAPI) {
        const res = await window.redbusAPI.factoryReset();
        if (res.status === 'OK') {
          // Clear everything and reboot for a clean start
          window.location.reload();
        }
      }
    } catch (e) {
      console.error('Factory reset failed:', e);
    }
    setResetting(false);
  };

  const handleChooseLanguage = async (lang: 'en' | 'pt-BR') => {
    setLang(lang);
    if (window.redbusAPI) {
      await window.redbusAPI.setAppSetting('language', lang);
    }
    setAppLanguage(lang);
    window.dispatchEvent(new CustomEvent('redbus-lang-changed', { detail: { lang } }));
  };

  const handleLanguageChangeRequest = (lang: 'en' | 'pt-BR') => {
    if (lang === appLanguage) return;
    setPendingLang(lang);
    setShowLangWarning(true);
  };

  const handleConfirmLanguageChange = async () => {
    if (!pendingLang) return;
    if (window.redbusAPI) {
      await window.redbusAPI.setAppSetting('language', pendingLang);
    }
    setLang(pendingLang);
    setAppLanguage(pendingLang);
    window.dispatchEvent(new CustomEvent('redbus-lang-changed', { detail: { lang: pendingLang } }));
    setPendingLang(null);
    setShowLangWarning(false);
  };

  // Seed the greeting only after onboarding completes, otherwise the effect
  // fires with the English default and latches the message before the user
  // has chosen a language in the wizard.
  useEffect(() => {
    if (loaded && setupCompleted && appLanguage && messages.length === 0) {
      setMessages([{ id: uuidv4(), role: 'assistant', content: t.app.greeting }]);
    }
  }, [loaded, setupCompleted, appLanguage, messages.length, t.app.greeting]);

  if (!loaded || profileExists === null) return <div className="loading">{t.app.loading}</div>;

  // ── First-launch LLM / role setup overlay (Spec 08) — language picker lives inside the Welcome step ──
  if (setupCompleted === false) {
    return (
      <OnboardingShell
        language={appLanguage}
        onLanguageChange={handleChooseLanguage}
        onComplete={async () => {
          setSetupCompleted(true);
          // Re-hydrate keys and roles from the freshly-persisted config.
          const response = await window.redbusAPI.getProviderConfigs();
          if (response.status === 'OK' && response.data) {
            const { openAiKey, anthropicKey, googleKey, ollamaUrl, ollamaCloudKey, ollamaCloudUrl, roles: loadedRoles } = response.data;
            setKeys({
              openAiKey: openAiKey || '',
              anthropicKey: anthropicKey || '',
              googleKey: googleKey || '',
              ollamaUrl: ollamaUrl || 'http://localhost:11434',
              ollamaCloudKey: ollamaCloudKey || '',
              ollamaCloudUrl: ollamaCloudUrl || 'https://ollama.com',
            });
            if (loadedRoles) setRoles({ ...DEFAULT_ROLES, ...loadedRoles } as RolesMap);
          }
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <TitleBar
        subtitle={isProcessing ? t.app.processing : undefined}
        activeView={activeView}
        onViewChange={handleViewChange}
        activityConsoleOpen={activityConsoleOpen}
        onToggleActivityConsole={() => setActivityConsoleOpen(prev => !prev)}
      />

      <main className="main-content">
        {activeView === 'chat' && (
          <>
            <MessageList assistantName={assistantName} userName={userName} messages={
              streaming.isActive
                ? [...messages, {
                  id: '__streaming__',
                  role: 'assistant' as const,
                  content: '',
                  streaming: {
                    isThinking: streaming.isThinking,
                    thinkingText: streaming.thinkingText,
                    tools: streaming.tools,
                    isStreaming: streaming.isStreaming,
                    streamedText: streaming.streamedText,
                    workerActive: streaming.workerActive,
                    workerLabel: streaming.workerLabel,
                  },
                }]
                : messages
            } />
            <ChatInput onSend={handleSendMessage} disabled={isProcessing} />
          </>
        )}

        {activeView === 'history' && (
          <HistoryView />
        )}

        {activeView === 'skills' && (
          <SkillManager />
        )}

        {activeView === 'routines' && (
          <RoutineManager />
        )}

        {activeView === 'meetings' && (
          <MeetingsView initialMeetingId={initialMeetingId} onMeetingSelected={() => setInitialMeetingId(null)} />
        )}

        {activeView === 'comms' && (
          <CommunicationHub />
        )}

        {activeView === 'todos' && (
          <TodoManager />
        )}

        {activeView === 'meeting-review' && meetingReviewData && (
          <MeetingReview
            data={meetingReviewData}
            onSave={() => { setMeetingReviewData(null); setActiveView('chat'); }}
            onDiscard={() => { setMeetingReviewData(null); setActiveView('chat'); }}
          />
        )}

        {activeView === 'settings' && (
          <div className="settings-overlay">
            {/* ── Sidebar Tabs ── */}
            <nav className="settings-sidebar">
              <div className="settings-sidebar-title">{t.settings.title}</div>
              <button className={`settings-tab${settingsTab === 'llm' ? ' active' : ''}`} onClick={() => setSettingsTab('llm')}>
                <BrainCircuit size={15} className="settings-tab-icon" /> {t.settings.tabs.llm}
              </button>
              <button className={`settings-tab${settingsTab === 'vault' ? ' active' : ''}`} onClick={() => { setSettingsTab('vault'); loadVaultSecrets(); }}>
                <ShieldCheck size={15} className="settings-tab-icon" /> {t.settings.tabs.vault}
              </button>
              <button className={`settings-tab${settingsTab === 'audio' ? ' active' : ''}`} onClick={() => setSettingsTab('audio')}>
                <Mic size={15} className="settings-tab-icon" /> {t.settings.tabs.audio}
              </button>
              <button className={`settings-tab${settingsTab === 'proactivity' ? ' active' : ''}`} onClick={() => setSettingsTab('proactivity')}>
                <Zap size={15} className="settings-tab-icon" /> {t.settings.tabs.proactivity}
              </button>
              <button className={`settings-tab${settingsTab === 'digest' ? ' active' : ''}`} onClick={() => { setSettingsTab('digest'); if (!digestCurationLoaded) loadDigestCuration(); }}>
                <MessagesSquare size={15} className="settings-tab-icon" /> {t.settings.tabs.digest}
              </button>
              <button className={`settings-tab${settingsTab === 'system' ? ' active' : ''}`} onClick={() => setSettingsTab('system')}>
                <Settings size={15} className="settings-tab-icon" /> {t.settings.tabs.system}
              </button>
            </nav>

            {/* ── Content Area ── */}
            <div className="settings-content">
              <div className="settings-content-inner">

                {/* ═══ TAB: LLM & Modelos ═══ */}
                {settingsTab === 'llm' && (
                  <div className="settings-panel">
                    <header className="top-bar">
                      <div>
                        <h1>{t.settings.llm.title}</h1>
                        <p className="subtitle">{t.settings.llm.subtitle}</p>
                      </div>
                      <button className="save-btn" onClick={handleSaveSettings}>
                        {saving ? t.settings.llm.saving : t.settings.llm.save}
                      </button>
                    </header>

                    <OllamaSettings
                      ollamaUrl={keys.ollamaUrl}
                      setOllamaUrl={(url) => setKeys(k => ({ ...k, ollamaUrl: url }))}
                      onModelSet={handleSetRoleModel}
                      onInstalledChange={setOllamaModels}
                    />

                    <section className="settings-section">
                      <div className="section-head"><h3>{t.settings.llm.apiKeys}</h3></div>
                      <div className="form-grid">
                        <div className="form-group">
                          <label>openai</label>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input type="password" style={{ flex: 1 }} placeholder="sk-..." value={keys.openAiKey} onChange={e => setKeys(k => ({ ...k, openAiKey: e.target.value }))} />
                            <button className="save-btn" onClick={() => validateKey('openai', keys.openAiKey)}>
                              {apiStatus.openai === 'loading' ? <Loader2 size={13} className="spinner" /> : t.settings.llm.check}
                            </button>
                            {apiStatus.openai === 'valid' && <CheckCircle2 color="#ff6b2b" size={16} />}
                            {apiStatus.openai === 'invalid' && <XCircle color="#ff6b2b" size={16} />}
                          </div>
                        </div>
                        <div className="form-group">
                          <label>anthropic</label>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input type="password" style={{ flex: 1 }} placeholder="sk-ant-..." value={keys.anthropicKey} onChange={e => setKeys(k => ({ ...k, anthropicKey: e.target.value }))} />
                            <button className="save-btn" onClick={() => validateKey('anthropic', keys.anthropicKey)}>
                              {apiStatus.anthropic === 'loading' ? <Loader2 size={13} className="spinner" /> : t.settings.llm.check}
                            </button>
                            {apiStatus.anthropic === 'valid' && <CheckCircle2 color="#ff6b2b" size={16} />}
                            {apiStatus.anthropic === 'invalid' && <XCircle color="#ff6b2b" size={16} />}
                          </div>
                        </div>
                        <div className="form-group">
                          <label>google gemini</label>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input type="password" style={{ flex: 1 }} placeholder="AIza..." value={keys.googleKey} onChange={e => setKeys(k => ({ ...k, googleKey: e.target.value }))} />
                            <button className="save-btn" onClick={() => validateKey('google', keys.googleKey)}>
                              {apiStatus.google === 'loading' ? <Loader2 size={13} className="spinner" /> : t.settings.llm.check}
                            </button>
                            {apiStatus.google === 'valid' && <CheckCircle2 color="#ff6b2b" size={16} />}
                            {apiStatus.google === 'invalid' && <XCircle color="#ff6b2b" size={16} />}
                          </div>
                        </div>
                        <div className="form-group">
                          <label>ollama cloud</label>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input type="password" style={{ flex: 1 }} placeholder="api key..." value={keys.ollamaCloudKey} onChange={e => setKeys(k => ({ ...k, ollamaCloudKey: e.target.value }))} />
                            <button className="save-btn" onClick={() => validateKey('ollama-cloud', keys.ollamaCloudKey)}>
                              {apiStatus.ollamaCloud === 'loading' ? <Loader2 size={13} className="spinner" /> : t.settings.llm.check}
                            </button>
                            {apiStatus.ollamaCloud === 'valid' && <CheckCircle2 color="#ff6b2b" size={16} />}
                            {apiStatus.ollamaCloud === 'invalid' && <XCircle color="#ff6b2b" size={16} />}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="section-head">
                        <h3>{t.settings.llm.roles.title}</h3>
                        <p>{t.settings.llm.orchestrationDesc}</p>
                      </div>

                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px', fontSize: '11px' }}>
                        <label style={{ display: 'flex', gap: '4px', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            checked={rolesMode === 'simple'}
                            onChange={() => setRolesMode('simple')}
                          />
                          {t.settings.llm.roles.simpleMode}
                        </label>
                        <label style={{ display: 'flex', gap: '4px', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            checked={rolesMode === 'advanced'}
                            onChange={() => setRolesMode('advanced')}
                          />
                          {t.settings.llm.roles.advancedMode}
                        </label>
                        <div style={{ flex: 1 }} />
                        <button className="save-btn" style={{ fontSize: '10px' }} onClick={handleCopyPlannerToAll}>
                          {t.settings.llm.roles.copyPlannerToAll}
                        </button>
                        <button className="save-btn" style={{ fontSize: '10px' }} onClick={handleResetRoles}>
                          {t.settings.llm.roles.resetDefaults}
                        </button>
                      </div>

                      {rolesMode === 'simple' ? (
                        <div className="form-group">
                          <label>model (all roles)</label>
                          <select value={roles.planner?.model ?? ''} onChange={e => handleSimpleModelChange(e.target.value)}>
                            <optgroup label="Anthropic">
                              {availableModels.anthropic.length > 0 ? availableModels.anthropic.map(m => <option key={m.id} value={m.id}>{m.name}</option>) : <option value="none" disabled>—</option>}
                            </optgroup>
                            <optgroup label="OpenAI">
                              {availableModels.openai.length > 0 ? availableModels.openai.map(m => <option key={m.id} value={m.id}>{m.name}</option>) : <option value="none" disabled>—</option>}
                            </optgroup>
                            <optgroup label="Google">
                              {availableModels.google.length > 0 ? availableModels.google.map(m => <option key={m.id} value={m.id}>{m.name}</option>) : <option value="none" disabled>—</option>}
                            </optgroup>
                            <optgroup label="Ollama Cloud">
                              {availableModels.ollamaCloud.length > 0 ? availableModels.ollamaCloud.map(m => <option key={m.id} value={`ollama-cloud/${m.id}`}>{m.name}</option>) : <option value="none" disabled>—</option>}
                            </optgroup>
                            <optgroup label="atual">
                              <option value={roles.planner?.model ?? ''} disabled>{roles.planner?.model ?? ''}</option>
                            </optgroup>
                            <optgroup label="Ollama (Local)">
                              {ollamaModels.map(m => <option key={m} value={`ollama/${m}`}>{m}</option>)}
                              {ollamaModels.length === 0 && <option value="" disabled>Nenhum modelo baixado</option>}
                            </optgroup>
                          </select>
                        </div>
                      ) : (
                        ROLE_NAMES.map(roleName => (
                          <RolePicker
                            key={roleName}
                            role={roleName}
                            title={t.settings.llm.roles[roleName].name}
                            description={t.settings.llm.roles[roleName].description}
                            binding={roles[roleName] ?? { model: '' }}
                            availableModels={availableModels}
                            ollamaModels={ollamaModels}
                            onChange={(patch) => handleChangeRole(roleName, patch)}
                          />
                        ))
                      )}
                    </section>
                  </div>
                )}

                {/* ═══ TAB: Cofre ═══ */}
                {settingsTab === 'vault' && (
                  <div className="settings-panel">
                    <header className="top-bar">
                      <div>
                        <h1>{t.settings.vault.title}</h1>
                        <p className="subtitle">{t.settings.vault.subtitle}</p>
                      </div>
                    </header>

                    <section className="settings-section">
                      <div className="section-head">
                        <h3>{t.settings.vault.savedTokens}</h3>
                        <p>{t.settings.vault.savedTokensDesc}</p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {vaultSecrets.length === 0 && (
                          <p style={{ color: 'var(--text-ghost)', fontSize: '13px' }}>{t.settings.vault.noTokens}</p>
                        )}
                        {vaultSecrets.map(s => (
                          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: '13px', color: 'var(--accent)' }}>{s.service_name}</div>
                            <button onClick={() => handleDeleteVaultSecret(s.id)} className="save-btn" style={{ color: 'var(--red)', borderColor: 'var(--red)', fontSize: '11px' }}>{t.settings.vault.del}</button>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="section-head"><h3>{t.settings.vault.addToken}</h3></div>
                      <div className="form-grid">
                        <div className="form-group">
                          <label>{t.settings.vault.service}</label>
                          <input placeholder={t.settings.vault.servicePlaceholder} value={newVaultService} onChange={e => setNewVaultService(e.target.value)} />
                        </div>
                        <div className="form-group">
                          <label>{t.settings.vault.tokenKey}</label>
                          <input type="password" placeholder={t.settings.vault.tokenPlaceholder} value={newVaultToken} onChange={e => setNewVaultToken(e.target.value)} />
                        </div>
                        <button className="save-btn" onClick={handleAddVaultSecret} disabled={!newVaultService || !newVaultToken} style={{ alignSelf: 'flex-start' }}>{t.settings.vault.add}</button>
                      </div>
                    </section>
                  </div>
                )}

                {/* ═══ TAB: Áudio ═══ */}
                {settingsTab === 'audio' && (
                  <div className="settings-panel">
                    <header className="top-bar">
                      <div>
                        <h1>{t.settings.audio.title}</h1>
                        <p className="subtitle">{t.settings.audio.subtitle}</p>
                      </div>
                    </header>

                    <section className="settings-section">
                      <div className="section-head"><h3>{t.settings.audio.devices}</h3></div>
                      <div className="governance-card">
                        <div className="governance-row">
                          <div className="governance-label">
                            <span className="governance-title"><Mic size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />{t.settings.audio.mic}</span>
                            <span className="governance-desc">{t.settings.audio.micDesc}</span>
                          </div>
                          <select
                            className="governance-select"
                            value={selectedMicId}
                            onChange={async (e) => { setSelectedMicId(e.target.value); await window.redbusAPI.setAppSetting('audio_mic_device_id', e.target.value); }}
                          >
                            <option value="">{t.settings.audio.selectMic}</option>
                            {audioDevices.filter(d => !d.label.toLowerCase().includes('redbusaudio')).map(d => (
                              <option key={d.deviceId} value={d.deviceId}>{d.label || `Microfone (${d.deviceId.slice(0, 8)})`}</option>
                            ))}
                          </select>
                        </div>
                        <div className="governance-row">
                          <div className="governance-label">
                            <span className="governance-title"><Volume2 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />{t.settings.audio.systemAudio}</span>
                            <span className="governance-desc">{t.settings.audio.systemAudioDesc}</span>
                          </div>
                          <select
                            className="governance-select"
                            value={selectedSystemId}
                            onChange={async (e) => { setSelectedSystemId(e.target.value); await window.redbusAPI.setAppSetting('audio_system_device_id', e.target.value); }}
                          >
                            <option value="">{t.settings.audio.selectLoopback}</option>
                            {audioDevices.map(d => (
                              <option key={d.deviceId} value={d.deviceId}>{d.label || `Dispositivo (${d.deviceId.slice(0, 8)})`}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="section-head"><h3>{t.settings.audio.transcriptionMode}</h3></div>
                      <div className="audio-mode-cards">
                        <button
                          className={`audio-mode-card${transcriptionMode === 'FULL_CLOUD' ? ' selected' : ''}`}
                          onClick={async () => { setTranscriptionMode('FULL_CLOUD'); await window.redbusAPI.setAppSetting('transcription_mode', 'FULL_CLOUD'); }}
                        >
                          <Cloud size={18} className="audio-mode-icon" />
                          <span className="audio-mode-title">Full Nuvem (Máxima Performance)</span>
                          <span className="audio-mode-desc">Envia o áudio para a API configurada (Gemini/Whisper). Não consome CPU, mas requer envio de voz para a nuvem.</span>
                        </button>
                        <button
                          className={`audio-mode-card${transcriptionMode === 'HYBRID_LOCAL' ? ' selected' : ''}`}
                          onClick={async () => { setTranscriptionMode('HYBRID_LOCAL'); await window.redbusAPI.setAppSetting('transcription_mode', 'HYBRID_LOCAL'); }}
                        >
                          <ShieldEllipsis size={18} className="audio-mode-icon" />
                          <span className="audio-mode-title">Híbrido (STT Local + Nuvem)</span>
                          <span className="audio-mode-desc">Voz convertida em texto na sua máquina (consome CPU). Apenas o texto vai para a nuvem gerar a ata.</span>
                          <span className="audio-mode-badge">whisper-tiny ~77MB · WASM · sem GPU</span>
                        </button>
                      </div>
                    </section>

                    {transcriptionMode === 'FULL_CLOUD' && (
                      <section className="settings-section">
                        <div className="section-head"><h3>{t.settings.audio.cloudEngine}</h3></div>
                        <div className="governance-card">
                          <div className="governance-row">
                            <div className="governance-label">
                              <span className="governance-title">{t.settings.audio.provider}</span>
                              <span className="governance-desc">{t.settings.audio.providerDesc}</span>
                            </div>
                            <select
                              className="governance-select"
                              value={transcriptionEngine}
                              onChange={async (e) => {
                                const eng = e.target.value as 'gemini' | 'whisper';
                                setTranscriptionEngine(eng);
                                await window.redbusAPI.setAppSetting('transcription_engine', eng);
                              }}
                            >
                              <option value="gemini">Google (Gemini Native Audio)</option>
                              <option value="whisper">OpenAI (Whisper)</option>
                            </select>
                          </div>
                        </div>
                      </section>
                    )}
                  </div>
                )}

                {/* ═══ TAB: Proatividade ═══ */}
                {settingsTab === 'proactivity' && (
                  <div className="settings-panel">
                    <header className="top-bar">
                      <div>
                        <h1>{t.settings.proactivity.title}</h1>
                        <p className="subtitle">{t.settings.proactivity.subtitle}</p>
                      </div>
                    </header>

                    <section className="settings-section">
                      <div className="section-head">
                        <h3>{t.settings.proactivity.level}</h3>
                        <p>{t.settings.proactivity.levelDesc}</p>
                      </div>
                      <div className="governance-card">
                        <div className="governance-row">
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.proactivity.currentLevel}</span>
                          </div>
                          <select
                            className="governance-select"
                            value={proactivityLevel}
                            onChange={async (e) => {
                              const lvl = e.target.value as ProactivityLevel;
                              setProactivityLevel(lvl);
                              await window.redbusAPI.setProactivityLevel(lvl);
                            }}
                          >
                            {PROACTIVITY_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </div>
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="section-head">
                        <h3>timings por nível</h3>
                        <p>intervalo entre verificações e cooldown após cada interação proativa (em segundos).</p>
                      </div>
                      <div className="governance-card">
                        {PROACTIVITY_LEVELS.filter(l => l !== 'OFF').map((lvl, i) => {
                          const t = proactivityTimings[lvl] || { intervalMs: 180000, cooldownMs: 1800000 };
                          return (
                            <div key={lvl} className="governance-row" style={i > 0 ? { borderTop: '1px solid var(--border)', paddingTop: '12px' } : undefined}>
                              <div className="governance-label">
                                <span className="governance-title">{lvl}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <label style={{ fontSize: '11px', color: 'var(--text-ghost)' }}>int:</label>
                                <input
                                  type="number" min="5" style={{ width: '65px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-primary)', padding: '4px 6px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                                  value={Math.round(t.intervalMs / 1000)}
                                  onChange={e => setProactivityTimings(prev => ({ ...prev, [lvl]: { ...t, intervalMs: Math.max(5, Number(e.target.value)) * 1000 } }))}
                                />
                                <label style={{ fontSize: '11px', color: 'var(--text-ghost)' }}>cd:</label>
                                <input
                                  type="number" min="5" style={{ width: '65px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-primary)', padding: '4px 6px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                                  value={Math.round(t.cooldownMs / 1000)}
                                  onChange={e => setProactivityTimings(prev => ({ ...prev, [lvl]: { ...t, cooldownMs: Math.max(5, Number(e.target.value)) * 1000 } }))}
                                />
                                <button
                                  className="governance-btn"
                                  onClick={async () => {
                                    await window.redbusAPI.setProactivityTiming(lvl, t.intervalMs, t.cooldownMs);
                                  }}
                                >
                                  aplicar
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                )}

                {/* ═══ TAB: Digest ═══ */}
                {settingsTab === 'digest' && (
                  <div className="settings-panel">
                    <header className="top-bar">
                      <div>
                        <h1>{t.settings.digest.title}</h1>
                        <p className="subtitle">{t.settings.digest.subtitle}</p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button className="save-btn" style={{ fontSize: '10px' }} onClick={() => { setDigestCuration(DEFAULT_DIGEST_CURATION); setCustomAckDraft(DEFAULT_DIGEST_CURATION.customAckPatterns.join(', ')); }}>
                          {t.settings.digest.resetDefaults}
                        </button>
                        <button className="save-btn" onClick={handleSaveDigestCuration}>
                          {digestSaveStatus === 'saving' ? t.settings.digest.saving : digestSaveStatus === 'saved' ? t.settings.digest.saved : t.settings.digest.save}
                        </button>
                      </div>
                    </header>

                    {/* ── Noise filter ── */}
                    <section className="settings-section">
                      <div className="section-head">
                        <h3>{t.settings.digest.noise.title}</h3>
                        <p>{t.settings.digest.noise.desc}</p>
                      </div>
                      <div className="governance-card">
                        <div className="governance-row">
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.digest.noise.dropAcks}</span>
                            <span className="governance-desc">{t.settings.digest.noise.dropAcksDesc}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={digestCuration.dropAcks}
                            onChange={e => setDigestCuration(c => ({ ...c, dropAcks: e.target.checked }))}
                          />
                        </div>
                        <div className="governance-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.digest.noise.minLength}</span>
                            <span className="governance-desc">{t.settings.digest.noise.minLengthDesc}</span>
                          </div>
                          <input
                            type="number" min={0} max={200}
                            style={{ width: '65px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-primary)', padding: '4px 6px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                            value={digestCuration.minLength}
                            onChange={e => setDigestCuration(c => ({ ...c, minLength: Math.max(0, Number(e.target.value)) }))}
                          />
                        </div>
                        <div className="governance-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', flexDirection: 'column', alignItems: 'stretch' }}>
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.digest.noise.customAckPatterns}</span>
                            <span className="governance-desc">{t.settings.digest.noise.customAckPatternsDesc}</span>
                          </div>
                          <input
                            type="text"
                            placeholder={t.settings.digest.noise.customAckPatternsPlaceholder}
                            style={{ marginTop: '8px', width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-primary)', padding: '6px 8px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                            value={customAckDraft}
                            onChange={e => setCustomAckDraft(e.target.value)}
                            onBlur={() => setDigestCuration(c => ({ ...c, customAckPatterns: parseAckDraft(customAckDraft) }))}
                          />
                        </div>
                      </div>
                    </section>

                    {/* ── Signal preservation ── */}
                    <section className="settings-section">
                      <div className="section-head">
                        <h3>{t.settings.digest.signal.title}</h3>
                        <p>{t.settings.digest.signal.desc}</p>
                      </div>
                      <div className="governance-card">
                        <div className="governance-row">
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.digest.signal.signalLength}</span>
                            <span className="governance-desc">{t.settings.digest.signal.signalLengthDesc}</span>
                          </div>
                          <input
                            type="number" min={20} max={1000}
                            style={{ width: '65px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-primary)', padding: '4px 6px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                            value={digestCuration.signalLength}
                            onChange={e => setDigestCuration(c => ({ ...c, signalLength: Math.max(20, Number(e.target.value)) }))}
                          />
                        </div>
                        <div className="governance-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                          <div className="governance-label">
                            <span className="governance-desc" style={{ fontStyle: 'italic' }}>{t.settings.digest.signal.alwaysSignalHint}</span>
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* ── Thread grouping ── */}
                    <section className="settings-section">
                      <div className="section-head">
                        <h3>{t.settings.digest.thread.title}</h3>
                        <p>{t.settings.digest.thread.desc}</p>
                      </div>
                      <div className="governance-card">
                        <div className="governance-row">
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.digest.thread.neutralCap}</span>
                            <span className="governance-desc">{t.settings.digest.thread.neutralCapDesc}</span>
                          </div>
                          <input
                            type="number" min={0} max={20}
                            style={{ width: '65px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-primary)', padding: '4px 6px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                            value={digestCuration.neutralCapPerThread}
                            onChange={e => setDigestCuration(c => ({ ...c, neutralCapPerThread: Math.max(0, Number(e.target.value)) }))}
                          />
                        </div>
                        <div className="governance-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.digest.thread.alwaysKeepFirst}</span>
                            <span className="governance-desc">{t.settings.digest.thread.alwaysKeepFirstDesc}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={digestCuration.alwaysKeepFirst}
                            onChange={e => setDigestCuration(c => ({ ...c, alwaysKeepFirst: e.target.checked }))}
                          />
                        </div>
                        <div className="governance-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.digest.thread.alwaysKeepLast}</span>
                            <span className="governance-desc">{t.settings.digest.thread.alwaysKeepLastDesc}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={digestCuration.alwaysKeepLast}
                            onChange={e => setDigestCuration(c => ({ ...c, alwaysKeepLast: e.target.checked }))}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                {/* ═══ TAB: Sistema ═══ */}
                {settingsTab === 'system' && (
                  <div className="settings-panel">
                    <header className="top-bar">
                      <div>
                        <h1>{t.settings.system.title}</h1>
                        <p className="subtitle">{t.settings.system.subtitle}</p>
                      </div>
                    </header>

                    <section className="settings-section">
                      <div className="section-head">
                        <h3>{t.settings.system.governance}</h3>
                        <p>{t.settings.system.governanceDesc}</p>
                      </div>
                      <div className="governance-card">
                        <div className="governance-row">
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.system.manualCleanup}</span>
                            <span className="governance-desc">{t.settings.system.manualCleanupDesc}</span>
                          </div>
                          <button
                            className="governance-btn"
                            onClick={async () => {
                              const res = await window.redbusAPI.cleanupNow();
                              if (res.status === 'OK') {
                                alert(t.settings.system.cleanResult(res.data?.deleted || 0));
                              }
                            }}
                          >
                            {t.settings.system.cleanNow}
                          </button>
                        </div>
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="section-head">
                        <h3>{t.settings.system.tldv}</h3>
                        <p>{t.settings.system.tldvDesc}</p>
                      </div>
                      <div className="governance-card">
                        <div className="governance-row">
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.system.tldvApiKey}</span>
                            <span className="governance-desc">{t.settings.system.tldvApiKeyDesc} <a href="https://tldv.io/app/api-key" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>tldv.io/app/api-key</a></span>
                          </div>
                          <input
                            type="password"
                            className="governance-select"
                            style={{ width: '220px', fontFamily: 'monospace', fontSize: '11px' }}
                            placeholder={t.settings.system.tldvPlaceholder}
                            ref={(el) => {
                              if (el) {
                                window.redbusAPI.getAppSetting('tldv_api_key').then(res => {
                                  if (res.status === 'OK' && res.data) el.value = res.data;
                                });
                              }
                            }}
                            onChange={(e) => {
                              const val = e.target.value.trim();
                              window.redbusAPI.setAppSetting('tldv_api_key', val);
                              // Notify TitleBar to show/hide sync button immediately
                              window.dispatchEvent(new CustomEvent('tldv-key-changed', { detail: { hasKey: val.length > 0 } }));
                            }}
                          />
                        </div>
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="section-head">
                        <h3><Globe size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />{t.settings.system.language}</h3>
                        <p>{t.settings.system.languageDesc}</p>
                      </div>
                      <div className="governance-card">
                        <div className="governance-row">
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.system.currentLanguage}</span>
                            <span className="governance-desc">{t.settings.system.currentLanguageDesc}</span>
                          </div>
                          <select
                            id="language-select"
                            className="governance-select"
                            value={appLanguage ?? 'en'}
                            onChange={(e) => handleLanguageChangeRequest(e.target.value as 'en' | 'pt-BR')}
                          >
                            <option value="en">🇬🇧 English</option>
                            <option value="pt-BR">🇧🇷 Português (BR)</option>
                          </select>
                        </div>
                      </div>
                    </section>

                    <section className="settings-section">
                      <div className="section-head">
                        <h3>{t.settings.system.resetSetup}</h3>
                        <p>{t.settings.system.resetSetupDesc}</p>
                      </div>
                      <div className="governance-card">
                        <div className="governance-row">
                          <div className="governance-label">
                            <span className="governance-title">{t.settings.system.resetSetup}</span>
                            <span className="governance-desc">{t.settings.system.resetSetupDesc}</span>
                          </div>
                          <button
                            className="governance-btn"
                            onClick={async () => {
                              const res = await window.redbusAPI.resetSetup();
                              if (res.status === 'OK') {
                                setSetupCompleted(false);
                              }
                            }}
                          >
                            {t.settings.system.resetSetupBtn}
                          </button>
                        </div>
                      </div>
                    </section>

                    <section className="settings-section" style={{ borderTop: '1px solid rgba(255,40,40,0.25)', paddingTop: '20px' }}>
                      <div className="section-head">
                        <h3 style={{ color: '#ff4040' }}>{t.settings.system.dangerZone}</h3>
                        <p>{t.settings.system.dangerZoneDesc}</p>
                      </div>
                      <div style={{ border: '1px solid rgba(255,40,40,0.2)', borderRadius: '6px', padding: '16px', background: 'rgba(255,40,40,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{t.settings.system.factoryReset}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '3px' }}>{t.settings.system.factoryResetDesc}</div>
                          </div>
                          <button
                            className="save-btn"
                            style={{ color: '#ff4040', borderColor: '#ff4040' }}
                            onClick={() => setShowResetModal(true)}
                          >
                            {t.settings.system.reset}
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                )}

              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Factory Reset Confirmation Modal ── */}
      {showResetModal && (
        <div className="modal-overlay" style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ background: 'var(--bg-elevated)', padding: '24px', borderRadius: '2px', border: '1px solid #ff4040', width: '380px' }}>
            <h3 style={{ color: '#ff4040', marginBottom: '8px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t.modals.reset.title}</h3>
            <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '16px', lineHeight: 1.5 }}>
              {t.modals.reset.body}<br />
              • {t.modals.reset.items[0]}<br />
              • {t.modals.reset.items[1]}<br />
              • {t.modals.reset.items[2]}<br />
              • {t.modals.reset.items[3]}<br /><br />
              {t.modals.reset.keysPreserved}
            </p>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '10px', color: 'var(--text-dim)', display: 'block', marginBottom: '4px' }}>
                {t.modals.reset.typeToConfirm} <strong style={{ color: '#ff4040' }}>{t.modals.reset.confirmWord}</strong> {t.modals.reset.toConfirm}
              </label>
              <input
                type="text"
                value={resetConfirmText}
                onChange={e => setResetConfirmText(e.target.value)}
                placeholder={t.modals.reset.confirmWord}
                style={{ width: '100%', boxSizing: 'border-box' }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="save-btn" onClick={() => { setShowResetModal(false); setResetConfirmText(''); }}>
                {t.modals.reset.cancel}
              </button>
              <button
                className="save-btn"
                style={{
                  color: resetConfirmText === 'RESETAR' ? '#fff' : 'var(--text-ghost)',
                  background: resetConfirmText === 'RESETAR' ? '#ff4040' : 'transparent',
                  borderColor: '#ff4040',
                  cursor: resetConfirmText === 'RESETAR' ? 'pointer' : 'not-allowed'
                }}
                disabled={resetConfirmText !== 'RESETAR' || resetting}
                onClick={handleFactoryReset}
              >
                {resetting ? t.modals.reset.confirming : t.modals.reset.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {authRequiredView && (
        <div className="auth-overlay">
          {/* Red border frame — positioned exactly around the BrowserView */}
          {authRequiredView.bounds && (
            <>
              <div className="auth-border-frame" style={{
                position: 'absolute',
                left: authRequiredView.bounds.x,
                top: authRequiredView.bounds.y,
                width: authRequiredView.bounds.width,
                height: authRequiredView.bounds.height,
              }} />
              {/* Button area below the BrowserView */}
              <div style={{
                position: 'absolute',
                left: authRequiredView.bounds.x,
                top: authRequiredView.bounds.y + authRequiredView.bounds.height + 8,
                width: authRequiredView.bounds.width,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
              }}>
                <button className="save-btn" style={{ fontSize: '10px', width: '100%', padding: '7px 0' }} onClick={handleAuthDone}>
                  {t.chat.alreadyLogged}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── HITL Consent Modal ── */}
      {hitlConsent && (
        <div className="modal-overlay" style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fadeIn 0.15s ease-out'
        }}>
          <div style={{
            background: 'var(--bg-elevated)', padding: '20px 24px', borderRadius: '2px',
            border: '1px solid var(--accent)', width: '400px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffaa00', animation: 'pulse 1s infinite' }} />
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#ffaa00', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {t.modals.hitlConsent.title}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '8px', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{t.modals.hitlConsent.reason}</strong> {hitlConsent.reason}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '16px', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{t.modals.hitlConsent.intendedAction}</strong> {hitlConsent.action}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="save-btn"
                style={{ flex: 1, fontSize: '11px', color: '#ff4040', borderColor: '#ff4040' }}
                onClick={() => handleConsentResponse(false)}
              >
                {t.modals.hitlConsent.deny}
              </button>
              <button
                className="save-btn"
                style={{ flex: 1, fontSize: '11px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
                onClick={() => handleConsentResponse(true)}
              >
                {t.modals.hitlConsent.approve}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Language Change Warning Modal ── */}
      {showLangWarning && (
        <div className="modal-overlay" style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.88)', zIndex: 1200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg-elevated)', padding: '24px', borderRadius: '4px',
            border: '1px solid #ffaa00', width: '420px', boxShadow: '0 12px 40px rgba(0,0,0,0.7)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffaa00', flexShrink: 0 }} />
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#ffaa00', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                {t.modals.langWarning.title}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.65, marginBottom: '16px' }}>
              {t.modals.langWarning.body1}<br /><br />
              {t.modals.langWarning.body2}<br /><br />
              <strong style={{ color: 'var(--text-primary)' }}>{t.modals.langWarning.recommendation}</strong> {t.modals.langWarning.recommendationBody}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="save-btn"
                onClick={() => { setShowLangWarning(false); setPendingLang(null); }}
              >
                {t.modals.langWarning.cancel}
              </button>
              <button
                id="lang-warning-confirm-btn"
                className="save-btn"
                style={{ color: '#ffaa00', borderColor: '#ffaa00' }}
                onClick={handleConfirmLanguageChange}
              >
                {t.modals.langWarning.changeAnyway}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activity Console (floating panel) */}
      <ActivityConsole
        isOpen={activityConsoleOpen}
        onClose={() => setActivityConsoleOpen(false)}
      />
    </div>
  );
}
