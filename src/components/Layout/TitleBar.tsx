import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { Settings, Archive, ArrowLeft, Code2, Timer, ClipboardCopy, AppWindow, Eye, Layers, Mic, Video, Terminal, Mail, MessageSquare, ListTodo, Minus, Square, X, Maximize2 } from 'lucide-react';

type ProactivityLevel = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';

const PROACTIVITY_META: Record<ProactivityLevel, { icon: string; label: string; color: string }> = {
  OFF: { icon: '⏸', label: 'Proatividade: Desligada', color: 'var(--text-ghost)' },
  LOW: { icon: '🟢', label: 'Proatividade: Baixa', color: '#4ade80' },
  MEDIUM: { icon: '🟡', label: 'Proatividade: Média', color: '#facc15' },
  HIGH: { icon: '🔴', label: 'Proatividade: Alta', color: '#f87171' },
};

const LEVELS: ProactivityLevel[] = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];

interface TitleBarProps {
  subtitle?: string;
  activeView: string;
  onViewChange: (view: string) => void;
  activityConsoleOpen?: boolean;
  onToggleActivityConsole?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({ subtitle, activeView, onViewChange, activityConsoleOpen, onToggleActivityConsole }) => {
  const { t } = useTranslation();
  const [clipboardEnabled, setClipboardEnabled] = useState(false);
  const [activeWindowEnabled, setActiveWindowEnabled] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [micRecording, setMicRecording] = useState(false);
  const [micMode, setMicMode] = useState<'FULL_CLOUD' | 'HYBRID_LOCAL'>('FULL_CLOUD');
  const [proactivityLevel, setProactivityLevel] = useState<ProactivityLevel>('MEDIUM');
  const [platform, setPlatform] = useState<string>('win32');
  const [isMaximized, setIsMaximized] = useState(false);
  useEffect(() => {
    window.redbusAPI.getSensorStatuses().then(res => {
      if (res.status === 'OK' && res.data) {
        const cb = res.data.find((s: any) => s.id === 'clipboard');
        if (cb) setClipboardEnabled(cb.enabled);
        const aw = res.data.find((s: any) => s.id === 'activeWindow');
        if (aw) setActiveWindowEnabled(aw.enabled);
        const vs = res.data.find((s: any) => s.id === 'vision');
        if (vs) setVisionEnabled(vs.enabled);
        const ax = res.data.find((s: any) => s.id === 'accessibility');
        if (ax) setAccessibilityEnabled(ax.enabled);
        const mic = res.data.find((s: any) => s.id === 'microphone');
        if (mic) setMicrophoneEnabled(mic.enabled);
      }
    });
    // Load transcription mode for tooltip
    window.redbusAPI.getAppSetting('transcription_mode').then(r => {
      if (r.status === 'OK' && r.data) setMicMode(r.data as any);
    });
    window.redbusAPI.getProactivityLevel().then(res => {
      if (res.status === 'OK' && res.data) setProactivityLevel(res.data);
    });
    // Detect platform and initial maximize state
    window.redbusAPI.getWindowPlatform().then(res => {
      if (res.status === 'OK' && res.data) setPlatform(res.data);
    });
    window.redbusAPI.isWindowMaximized().then(res => {
      if (res.status === 'OK') setIsMaximized(!!res.data);
    });
  }, []);

  const toggleClipboard = useCallback(async () => {
    const next = !clipboardEnabled;
    setClipboardEnabled(next);
    await window.redbusAPI.toggleSensor('clipboard', next);
  }, [clipboardEnabled]);

  const toggleActiveWindow = useCallback(async () => {
    const next = !activeWindowEnabled;
    setActiveWindowEnabled(next);
    await window.redbusAPI.toggleSensor('activeWindow', next);
  }, [activeWindowEnabled]);

  const toggleVision = useCallback(async () => {
    const next = !visionEnabled;
    setVisionEnabled(next);
    await window.redbusAPI.toggleSensor('vision', next);
  }, [visionEnabled]);

  const toggleAccessibility = useCallback(async () => {
    const next = !accessibilityEnabled;
    setAccessibilityEnabled(next);
    await window.redbusAPI.toggleSensor('accessibility', next);
  }, [accessibilityEnabled]);

  // ── Microphone / Audio Sensor — now just toggles the floating widget ──
  const [widgetOpen, setWidgetOpen] = useState(false);

  const toggleMicrophone = useCallback(async () => {
    if (widgetOpen) {
      // Close widget
      await window.redbusAPI.closeWidget();
      setWidgetOpen(false);
      setMicrophoneEnabled(false);
      setMicRecording(false);
      await window.redbusAPI.toggleSensor('microphone', false);
    } else {
      // Open widget
      await window.redbusAPI.openWidget();
      setWidgetOpen(true);
      setMicrophoneEnabled(true);
      await window.redbusAPI.toggleSensor('microphone', true);
    }
  }, [widgetOpen]);

  const cycleProactivity = useCallback(async () => {
    const idx = LEVELS.indexOf(proactivityLevel);
    const next = LEVELS[(idx + 1) % LEVELS.length];
    setProactivityLevel(next);
    await window.redbusAPI.setProactivityLevel(next);
  }, [proactivityLevel]);

  // Window controls — only for Windows & Linux
  const isMac = platform === 'darwin';

  const handleMinimize = useCallback(() => {
    window.redbusAPI.minimizeWindow();
  }, []);

  const handleMaximize = useCallback(async () => {
    await window.redbusAPI.maximizeWindow();
    const res = await window.redbusAPI.isWindowMaximized();
    if (res.status === 'OK') setIsMaximized(!!res.data);
  }, []);

  const handleClose = useCallback(() => {
    window.redbusAPI.closeWindow();
  }, []);

  return (
    <div className="titlebar">
      {/* Traffic lights space: macOS only */}
      {isMac && <div className="titlebar-traffic-pad" />}

      <div className={isMac ? 'titlebar-center' : 'titlebar-left'}>
        <span className="titlebar-dot" />
        <span className="titlebar-title">RedBus</span>
        {subtitle && <span className="titlebar-subtitle">{subtitle}</span>}
      </div>

      <div className="titlebar-actions">
        {/* ── Sensores ambientais (container agrupado) ── */}
        {/* ── Sensores ambientais (container agrupado) ── */}
        <div className="titlebar-sensor-group">
          <button
            className={`titlebar-sensor${clipboardEnabled ? ' active' : ''}`}
            onClick={toggleClipboard}
            title={clipboardEnabled ? t.titlebar.sensors.clipboard.on : t.titlebar.sensors.clipboard.off}
            data-testid="sensor-clipboard-toggle"
          >
            <ClipboardCopy size={11} />
          </button>
          <button
            className={`titlebar-sensor${activeWindowEnabled ? ' active' : ''}`}
            onClick={toggleActiveWindow}
            title={activeWindowEnabled ? t.titlebar.sensors.activeWindow.on : t.titlebar.sensors.activeWindow.off}
            data-testid="sensor-activewindow-toggle"
          >
            <AppWindow size={11} />
          </button>
          <button
            className={`titlebar-sensor${visionEnabled ? ' active' : ''}`}
            onClick={toggleVision}
            title={visionEnabled ? t.titlebar.sensors.vision.on : t.titlebar.sensors.vision.off}
            data-testid="sensor-vision-toggle"
          >
            <Eye size={11} />
          </button>
          <button
            className={`titlebar-sensor${accessibilityEnabled ? ' active' : ''}`}
            onClick={toggleAccessibility}
            title={accessibilityEnabled ? t.titlebar.sensors.accessibility.on : t.titlebar.sensors.accessibility.off}
            data-testid="sensor-accessibility-toggle"
          >
            <Layers size={11} />
          </button>
          <button
            className={`titlebar-sensor${widgetOpen ? ' active' : ''}`}
            onClick={toggleMicrophone}
            title={widgetOpen ? t.titlebar.sensors.mic.on : t.titlebar.sensors.mic.off}
            data-testid="sensor-microphone-toggle"
          >
            <Mic size={11} />
          </button>

        </div>

        {/* ── Proactividade ── */}
        <button
          className={`titlebar-proactivity${proactivityLevel !== 'OFF' ? ' active' : ''}`}
          onClick={cycleProactivity}
          title={t.titlebar.proactivity[proactivityLevel]}
          data-testid="proactivity-toggle"
          style={{ color: PROACTIVITY_META[proactivityLevel].color }}
        >
          <span className="proactivity-icon">{PROACTIVITY_META[proactivityLevel].icon}</span>
          <span className="proactivity-label">{proactivityLevel}</span>
        </button>

        {/* ── Separador ── */}
        <div className="titlebar-separator" />

        {/* ── Navegação (à direita) ── */}
        <button className={`titlebar-btn${activeView === 'chat' ? ' active' : ''}`} onClick={() => onViewChange('chat')} title={t.titlebar.nav.chat} data-testid="chat-btn">
          <MessageSquare size={13} />
        </button>
        <button className={`titlebar-btn${activeView === 'meetings' ? ' active' : ''}`} onClick={() => onViewChange('meetings')} title={t.titlebar.nav.meetings} data-testid="meetings-btn">
          <Video size={13} />
        </button>
        <button className={`titlebar-btn${activeView === 'inbox' ? ' active' : ''}`} onClick={() => onViewChange('inbox')} title={t.titlebar.nav.inbox} data-testid="inbox-btn">
          <Mail size={13} />
        </button>
        <button className={`titlebar-btn${activeView === 'todos' ? ' active' : ''}`} onClick={() => onViewChange('todos')} title="to-dos" data-testid="todos-btn">
          <ListTodo size={13} />
        </button>
        <button className={`titlebar-btn${activeView === 'routines' ? ' active' : ''}`} onClick={() => onViewChange('routines')} title={t.titlebar.nav.routines} data-testid="routines-btn">
          <Timer size={13} />
        </button>
        <button className={`titlebar-btn${activeView === 'skills' ? ' active' : ''}`} onClick={() => onViewChange('skills')} title={t.titlebar.nav.skills} data-testid="skills-btn">
          <Code2 size={13} />
        </button>
        <button className={`titlebar-btn${activeView === 'history' ? ' active' : ''}`} onClick={() => onViewChange('history')} title={t.titlebar.nav.history}>
          <Archive size={13} />
        </button>
        <button className={`titlebar-btn${activeView === 'settings' ? ' active' : ''}`} onClick={() => onViewChange('settings')} title={t.titlebar.nav.settings}>
          <Settings size={13} />
        </button>

        {/* ── Activity Console toggle ── */}
        <div className="titlebar-separator" />
        <button
          className={`titlebar-btn titlebar-activity-btn${activityConsoleOpen ? ' active' : ''}`}
          onClick={onToggleActivityConsole}
          title={activityConsoleOpen ? t.titlebar.nav.activityConsole.close : t.titlebar.nav.activityConsole.open}
          data-testid="activity-console-toggle"
        >
          <Terminal size={13} />
        </button>

        {/* ── Window controls (Windows & Linux only) ── */}
        {!isMac && (
          <>
            <div className="titlebar-separator" />
            <div className="titlebar-wincontrols">
              <button
                className="titlebar-wbtn titlebar-wbtn--minimize"
                onClick={handleMinimize}
                title="Minimizar"
                data-testid="wc-minimize"
              >
                <Minus size={11} strokeWidth={2.5} />
              </button>
              <button
                className="titlebar-wbtn titlebar-wbtn--maximize"
                onClick={handleMaximize}
                title={isMaximized ? 'Restaurar' : 'Maximizar'}
                data-testid="wc-maximize"
              >
                {isMaximized
                  ? <Maximize2 size={10} strokeWidth={2.5} />
                  : <Square size={10} strokeWidth={2.5} />
                }
              </button>
              <button
                className="titlebar-wbtn titlebar-wbtn--close"
                onClick={handleClose}
                title="Fechar"
                data-testid="wc-close"
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
