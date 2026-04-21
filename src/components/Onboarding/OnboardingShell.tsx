/**
 * Onboarding shell (Spec 08). Five-step flow shown on first launch and
 * after `setup:reset` — gates the entire app until at least one provider
 * is configured and all four semantic roles have a model bound.
 *
 * Professional identity (name/email) is no longer collected here — it is
 * derived from the Microsoft Graph account (`graph.account.displayName` /
 * `graph.account.upn`) after the user connects their Teams/Outlook.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { ROLE_NAMES, type RolesMap } from '../../types/roles';
import { FlagEmoji } from '../FlagEmoji';

export type OnboardingLanguage = 'en' | 'pt-BR';

type StepId = 'welcome' | 'providers' | 'ollama' | 'roles' | 'review';
const STEPS: StepId[] = ['welcome', 'providers', 'ollama', 'roles', 'review'];

type ProviderId = 'openai' | 'anthropic' | 'google' | 'ollama-cloud';
type KeyState = 'idle' | 'checking' | 'valid' | 'invalid';
interface ProviderBox { key: string; state: KeyState; models: string[] }

export interface OnboardingShellProps {
  onComplete: () => void;
  language: OnboardingLanguage;
  onLanguageChange: (lang: OnboardingLanguage) => void | Promise<void>;
}

export function OnboardingShell({ onComplete, language, onLanguageChange }: OnboardingShellProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<StepId>('welcome');
  const [providers, setProviders] = useState<Record<ProviderId, ProviderBox>>({
    openai: { key: '', state: 'idle', models: [] },
    anthropic: { key: '', state: 'idle', models: [] },
    google: { key: '', state: 'idle', models: [] },
    'ollama-cloud': { key: '', state: 'idle', models: [] },
  });
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [rolesMode, setRolesMode] = useState<'auto' | 'manual'>('auto');
  const [roles, setRoles] = useState<RolesMap>({});
  const [finishing, setFinishing] = useState(false);

  const stepIndex = STEPS.indexOf(step);
  const goNext = () => setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)]);
  const goBack = () => setStep(STEPS[Math.max(stepIndex - 1, 0)]);

  const allRolesBound = ROLE_NAMES.every((r) => !!roles[r]?.model);

  const checkProvider = async (id: ProviderId) => {
    const box = providers[id];
    if (!box.key) return;
    setProviders((p) => ({ ...p, [id]: { ...p[id], state: 'checking' } }));
    const res = await window.redbusAPI.fetchAvailableModels(
      id, box.key, id === 'ollama-cloud' ? undefined : undefined,
    );
    if (res.status === 'OK' && res.data) {
      setProviders((p) => ({ ...p, [id]: { key: box.key, state: 'valid', models: (res.data as any[]).map((m) => m.id) } }));
    } else {
      setProviders((p) => ({ ...p, [id]: { ...p[id], state: 'invalid', models: [] } }));
    }
  };

  // Auto-probe the Ollama URL on mount and whenever it changes — so even the
  // providers step can tell the user whether local Ollama is already reachable.
  const probeOllama = async () => {
    setOllamaStatus('checking');
    const st = await window.redbusAPI.getOllamaStatus(ollamaUrl);
    const online = st.status === 'OK' && !!st.data;
    setOllamaStatus(online ? 'online' : 'offline');
    if (online) {
      const list = await window.redbusAPI.listOllamaModels(ollamaUrl);
      if (list.status === 'OK' && list.data) {
        setOllamaModels(list.data.map((m: any) => m.name));
      } else {
        setOllamaModels([]);
      }
    } else {
      setOllamaModels([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await probeOllama();
    })();
    return () => { cancelled = true; };
  }, [ollamaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // When entering the roles step, request recommendations based on reachable models.
  useEffect(() => {
    if (step !== 'roles') return;
    const availableByProvider: Record<string, string[]> = {
      openai: providers.openai.state === 'valid' ? providers.openai.models : [],
      anthropic: providers.anthropic.state === 'valid' ? providers.anthropic.models : [],
      google: providers.google.state === 'valid' ? providers.google.models : [],
      'ollama-cloud': providers['ollama-cloud'].state === 'valid' ? providers['ollama-cloud'].models : [],
      ollama: ollamaModels.map((m) => (m.startsWith('ollama/') ? m : `ollama/${m}`)),
    };
    (async () => {
      const res = await window.redbusAPI.recommendRoles(availableByProvider);
      if (res.status === 'OK' && res.data) setRoles(res.data as RolesMap);
    })();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const allReachableModels = useMemo(() => {
    const list: string[] = [];
    list.push(...providers.openai.models);
    list.push(...providers.anthropic.models);
    list.push(...providers.google.models);
    list.push(...providers['ollama-cloud'].models.map((m) => (m.startsWith('ollama-cloud/') ? m : `ollama-cloud/${m}`)));
    list.push(...ollamaModels.map((m) => (m.startsWith('ollama/') ? m : `ollama/${m}`)));
    return Array.from(new Set(list));
  }, [providers, ollamaModels]);

  const finish = async () => {
    setFinishing(true);
    try {
      // Persist language explicitly — defensive: the per-click setAppSetting in
      // handleChooseLanguage may race with other writes; this guarantees the
      // final choice lands in AppSettings before setup is marked complete.
      await window.redbusAPI.setAppSetting('language', language);
      await window.redbusAPI.saveProviderConfigs({
        openAiKey: providers.openai.state === 'valid' ? providers.openai.key : undefined,
        anthropicKey: providers.anthropic.state === 'valid' ? providers.anthropic.key : undefined,
        googleKey: providers.google.state === 'valid' ? providers.google.key : undefined,
        ollamaUrl,
        ollamaCloudKey: providers['ollama-cloud'].state === 'valid' ? providers['ollama-cloud'].key : undefined,
        roles,
      });
      await window.redbusAPI.markSetupComplete();
      onComplete();
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="lang-setup-overlay">
      <div className="lang-setup-card" style={{ width: 560, padding: '36px 44px', gap: 14 }}>
        <div className="lang-setup-logo"><span className="lang-setup-dot" /><span>redbus</span></div>
        <div style={{ fontSize: 10, color: 'var(--text-ghost)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {t.onboarding.stepLabel(stepIndex + 1, STEPS.length)} · {t.onboarding.shellTitle}
        </div>

        {step === 'welcome' && <StepWelcome language={language} onLanguageChange={onLanguageChange} />}
        {step === 'providers' && <StepProviders providers={providers} setProviders={setProviders} onCheck={checkProvider} ollamaStatus={ollamaStatus} ollamaModels={ollamaModels} />}
        {step === 'ollama' && <StepOllama url={ollamaUrl} setUrl={setOllamaUrl} status={ollamaStatus} models={ollamaModels} onRecheck={probeOllama} />}
        {step === 'roles' && <StepRoles roles={roles} setRoles={setRoles} mode={rolesMode} setMode={setRolesMode} allModels={allReachableModels} />}
        {step === 'review' && (
          <StepReview
            providers={providers}
            ollamaModels={ollamaModels}
            roles={roles}
          />
        )}

        <OnboardingFooter
          stepIndex={stepIndex} total={STEPS.length}
          canAdvance={step === 'roles' ? allRolesBound : true}
          onBack={goBack} onNext={goNext} onFinish={finish} finishing={finishing}
          isLast={step === 'review'}
        />
      </div>
    </div>
  );
}

// ── Step: welcome (includes the language picker) ──
function StepWelcome(props: {
  language: OnboardingLanguage;
  onLanguageChange: (lang: OnboardingLanguage) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const options: { id: OnboardingLanguage; flag: string; name: string; desc: string }[] = [
    { id: 'en', flag: '🇬🇧', name: t.langSetup.en.name, desc: t.langSetup.en.desc },
    { id: 'pt-BR', flag: '🇧🇷', name: t.langSetup.ptBR.name, desc: t.langSetup.ptBR.desc },
  ];
  return (
    <div style={{ textAlign: 'center', padding: '8px 0', width: '100%' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #e2e8f0)', margin: '0 0 12px' }}>
        {t.onboarding.welcome.headline}
      </h2>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7, margin: '0 0 12px' }}>
        {t.onboarding.welcome.body}
      </p>
      <p style={{ fontSize: 10, color: 'var(--text-ghost)', lineHeight: 1.6, margin: '0 0 16px' }}>
        {t.onboarding.welcome.privacy}<br />{t.onboarding.welcome.local}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 12px' }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        <span style={{ fontSize: 9, color: 'var(--text-ghost)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
          {t.langSetup.divider}
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {options.map((opt) => {
          const selected = props.language === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => props.onLanguageChange(opt.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '14px 10px',
                background: selected ? 'rgba(255, 95, 31, 0.08)' : 'var(--bg-surface)',
                border: `1px solid ${selected ? 'var(--accent, #ff5f1f)' : 'var(--border)'}`,
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'background 150ms, border-color 150ms',
              }}
            >
              <FlagEmoji flag={opt.flag} size={28} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary, #e2e8f0)' }}>{opt.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>{opt.desc}</span>
            </button>
          );
        })}
      </div>

      <p style={{ fontSize: 9, color: 'var(--text-ghost)', lineHeight: 1.5, marginTop: 14 }}>
        {t.langSetup.footnote}
      </p>
    </div>
  );
}

// ── Step: providers ──
function StepProviders(props: {
  providers: Record<ProviderId, ProviderBox>;
  setProviders: React.Dispatch<React.SetStateAction<Record<ProviderId, ProviderBox>>>;
  onCheck: (id: ProviderId) => void;
  ollamaStatus: 'idle' | 'checking' | 'online' | 'offline';
  ollamaModels: string[];
}) {
  const { t } = useTranslation();
  const labels: Record<ProviderId, string> = {
    openai: t.onboarding.providers.openai,
    anthropic: t.onboarding.providers.anthropic,
    google: t.onboarding.providers.google,
    'ollama-cloud': t.onboarding.providers.ollamaCloud,
  };
  const ids: ProviderId[] = ['openai', 'anthropic', 'google', 'ollama-cloud'];
  const ollamaReady = props.ollamaStatus === 'online' && props.ollamaModels.length > 0;
  return (
    <div style={{ width: '100%' }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #e2e8f0)', margin: '0 0 6px' }}>{t.onboarding.providers.title}</h3>
      <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 14px', lineHeight: 1.5 }}>{t.onboarding.providers.subtitle}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ids.map((id) => {
          const box = props.providers[id];
          return (
            <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 160, fontSize: 11, color: 'var(--text-dim)' }}>{labels[id]}</span>
              <input
                type="password" placeholder="paste key..." value={box.key}
                onChange={(e) => props.setProviders((p) => ({ ...p, [id]: { ...p[id], key: e.target.value, state: 'idle' } }))}
                style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary, #e2e8f0)', padding: '6px 8px', fontSize: 11, fontFamily: 'var(--font-mono)' }}
              />
              <button
                className="save-btn" style={{ fontSize: 10, minWidth: 64 }}
                onClick={() => props.onCheck(id)}
                disabled={!box.key || box.state === 'checking'}
              >
                {box.state === 'checking' ? t.onboarding.providers.testing
                  : box.state === 'valid' ? `✓ ${t.onboarding.providers.valid}`
                    : box.state === 'invalid' ? `✗ ${t.onboarding.providers.invalid}`
                      : t.onboarding.providers.test}
              </button>
            </div>
          );
        })}
      </div>
      {/* Inline Ollama status — probed on mount, surfaced here so the user
          knows whether anything extra is needed before the dedicated step. */}
      <div style={{
        marginTop: 14,
        padding: '8px 10px',
        border: `1px solid ${ollamaReady ? 'rgba(74, 222, 128, 0.3)' : 'var(--border)'}`,
        borderRadius: 4,
        background: ollamaReady ? 'rgba(74, 222, 128, 0.06)' : 'var(--bg-surface)',
        fontSize: 10,
        color: ollamaReady ? '#4ade80' : 'var(--text-dim)',
        lineHeight: 1.5,
      }}>
        {ollamaReady
          ? `✓ ${t.onboarding.providers.ollamaDetected(props.ollamaModels.length)}`
          : props.ollamaStatus === 'checking'
            ? t.onboarding.ollama.checking
            : t.onboarding.providers.ollamaMissing}
      </div>

    </div>
  );
}

// ── Step: ollama ──
function StepOllama(props: {
  url: string;
  setUrl: (v: string) => void;
  status: 'idle' | 'checking' | 'online' | 'offline';
  models: string[];
  onRecheck: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [rechecking, setRechecking] = useState(false);
  const badgeColor = props.status === 'online' ? '#4ade80' : props.status === 'offline' ? '#ff5f5f' : 'var(--text-ghost)';
  const badgeText = props.status === 'online' ? t.onboarding.ollama.online
    : props.status === 'offline' ? t.onboarding.ollama.offline
      : t.onboarding.ollama.checking;
  const handleRecheck = async () => {
    setRechecking(true);
    try { await props.onRecheck(); } finally { setRechecking(false); }
  };
  return (
    <div style={{ width: '100%' }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #e2e8f0)', margin: '0 0 6px' }}>{t.onboarding.ollama.title}</h3>
      <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 14px', lineHeight: 1.5 }}>{t.onboarding.ollama.subtitle}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <span style={{ width: 140, fontSize: 11, color: 'var(--text-dim)' }}>{t.onboarding.ollama.urlLabel}</span>
        <input
          type="text" value={props.url}
          onChange={(e) => props.setUrl(e.target.value)}
          placeholder="http://localhost:11434"
          style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary, #e2e8f0)', padding: '6px 8px', fontSize: 11, fontFamily: 'var(--font-mono)' }}
        />
        <button
          className="save-btn" style={{ fontSize: 10, minWidth: 72 }}
          onClick={handleRecheck} disabled={rechecking || props.status === 'checking'}
        >
          {rechecking || props.status === 'checking' ? t.onboarding.ollama.rechecking : t.onboarding.ollama.recheck}
        </button>
      </div>
      <div style={{ fontSize: 10, color: badgeColor, marginBottom: 12, fontFamily: 'var(--font-mono)' }}>● {badgeText}</div>

      {props.status === 'online' ? (
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {t.onboarding.ollama.detectedModels(props.models.length)}
          {props.models.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {props.models.slice(0, 12).map((m) => (
                <li key={m} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-primary, #e2e8f0)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 6px' }}>{m}</li>
              ))}
            </ul>
          )}
          {props.models.length === 0 && (
            <p style={{ fontSize: 10, color: 'var(--text-ghost)', marginTop: 8 }}>{t.onboarding.ollama.noModelsHint}</p>
          )}
        </div>
      ) : (
        <div style={{
          padding: 12, borderRadius: 6,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
        }}>
          <p style={{ fontSize: 11, color: 'var(--text-primary, #e2e8f0)', lineHeight: 1.5, margin: '0 0 10px' }}>
            {t.onboarding.ollama.installHint}
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <a
              href="https://ollama.com/download" target="_blank" rel="noreferrer"
              className="save-btn"
              style={{ fontSize: 10, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              ↗ {t.onboarding.ollama.install}
            </a>
            <span style={{ fontSize: 10, color: 'var(--text-ghost)', lineHeight: 1.5 }}>
              {t.onboarding.ollama.remoteHint}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step: roles ──
function StepRoles(props: {
  roles: RolesMap;
  setRoles: React.Dispatch<React.SetStateAction<RolesMap>>;
  mode: 'auto' | 'manual';
  setMode: (m: 'auto' | 'manual') => void;
  allModels: string[];
}) {
  const { t } = useTranslation();
  const bound = ROLE_NAMES.every((r) => !!props.roles[r]?.model);
  const hasModels = props.allModels.length > 0;
  return (
    <div style={{ width: '100%' }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #e2e8f0)', margin: '0 0 6px' }}>{t.onboarding.roles.title}</h3>
      <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 12px', lineHeight: 1.5 }}>{t.onboarding.roles.subtitle}</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['auto', 'manual'] as const).map((m) => (
          <button
            key={m} className="save-btn"
            onClick={() => props.setMode(m)}
            style={{ fontSize: 10, background: props.mode === m ? 'var(--accent)' : 'transparent', color: props.mode === m ? '#000' : 'var(--text-dim)' }}
          >
            {m === 'auto' ? t.onboarding.roles.auto : t.onboarding.roles.manual}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ROLE_NAMES.map((role) => {
          const current = props.roles[role]?.model ?? '';
          return (
            <div key={role} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 120, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{role}</span>
              <select
                value={current} disabled={props.mode === 'auto'}
                onChange={(e) => props.setRoles((r) => ({ ...r, [role]: { ...(r[role] ?? {}), model: e.target.value } }))}
                style={{ flex: 1, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary, #e2e8f0)', padding: '6px 8px', fontSize: 11, fontFamily: 'var(--font-mono)' }}
              >
                <option value="">—</option>
                {props.allModels.map((m) => <option key={m} value={m}>{m}</option>)}
                {current && !props.allModels.includes(current) && <option value={current}>{current}</option>}
              </select>
            </div>
          );
        })}
      </div>
      {!hasModels && <p style={{ fontSize: 10, color: '#ff5f5f', marginTop: 14, lineHeight: 1.5 }}>⚠ {t.onboarding.roles.noModelAvailable}</p>}
      {hasModels && !bound && <p style={{ fontSize: 10, color: '#ffaa00', marginTop: 14, lineHeight: 1.5 }}>⚠ {t.onboarding.roles.setupIncomplete}</p>}
    </div>
  );
}

// ── Step: review ──
function StepReview(props: {
  providers: Record<ProviderId, ProviderBox>;
  ollamaModels: string[];
  roles: RolesMap;
}) {
  const { t } = useTranslation();
  const connected = Object.entries(props.providers)
    .filter(([, b]) => b.state === 'valid')
    .map(([id]) => id);
  if (props.ollamaModels.length > 0) connected.push('ollama');
  return (
    <div style={{ width: '100%' }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #e2e8f0)', margin: '0 0 6px' }}>{t.onboarding.review.title}</h3>
      <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '0 0 14px', lineHeight: 1.5 }}>{t.onboarding.review.subtitle}</p>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: 'var(--text-ghost)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{t.onboarding.review.keysHeading}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {connected.map((id) => (
            <span key={id} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-primary, #e2e8f0)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 6px' }}>{id}</span>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-ghost)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{t.onboarding.review.rolesHeading}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ROLE_NAMES.map((role) => (
            <div key={role} style={{ display: 'flex', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <span style={{ width: 120, color: 'var(--text-dim)' }}>{role}</span>
              <span style={{ color: 'var(--text-primary, #e2e8f0)' }}>{props.roles[role]?.model ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Footer ──
function OnboardingFooter(props: {
  stepIndex: number;
  total: number;
  canAdvance: boolean;
  onBack: () => void;
  onNext: () => void;
  onFinish: () => void;
  finishing: boolean;
  isLast: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: 18, gap: 10 }}>
      <button
        className="save-btn" style={{ fontSize: 10, visibility: props.stepIndex === 0 ? 'hidden' : 'visible' }}
        onClick={props.onBack} disabled={props.finishing}
      >
        ← {t.onboarding.back}
      </button>
      {props.isLast ? (
        <button
          className="save-btn" style={{ fontSize: 10, background: 'var(--accent)', color: '#000' }}
          onClick={props.onFinish} disabled={!props.canAdvance || props.finishing}
        >
          {props.finishing ? '...' : t.onboarding.finish}
        </button>
      ) : (
        <button
          className="save-btn" style={{ fontSize: 10 }}
          onClick={props.onNext} disabled={!props.canAdvance}
        >
          {t.onboarding.next} →
        </button>
      )}
    </div>
  );
}

