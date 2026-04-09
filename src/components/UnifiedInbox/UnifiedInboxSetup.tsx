/**
 * UnifiedInboxSetup — Executive Inbox Channel Management UI.
 *
 * Displays 2 channel cards (Outlook 365, Teams V2) with:
 * - Authentication buttons that open visible BrowserWindows for manual login
 * - Status indicators (disconnected → authenticating → connected → error)
 * - Briefing panel showing urgency-classified messages
 * - Draft replies button for urgent messages
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Mail, Hash, Loader2, RefreshCcw, FileEdit, Wifi, WifiOff, AlertTriangle } from 'lucide-react';

interface ChannelState {
  id: string;
  label: string;
  url: string;
  status: 'disconnected' | 'authenticating' | 'extracting' | 'connected' | 'error';
  lastPollAt: string | null;
  lastMessages: any[];
  errorMessage?: string;
}

interface BriefingResult {
  generatedAt: string;
  totalMessages: number;
  urgentCount: number;
  briefingText: string;
  messages: any[];
}

interface DraftReply {
  channel: string;
  sender: string;
  draft: string;
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  outlook: <Mail size={20} />,
  teams: <Hash size={20} />,
};

const CHANNEL_COLORS: Record<string, string> = {
  outlook: '#0078d4',
  teams: '#6264a7',
};

export const UnifiedInboxSetup: React.FC = () => {
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [drafts, setDrafts] = useState<DraftReply[]>([]);
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [injectingDraft, setInjectingDraft] = useState<string | null>(null);

  // Load channel statuses on mount
  useEffect(() => {
    loadStatuses();

    // Listen for real-time updates
    if (window.redbusAPI?.onChannelStatusChanged) {
      window.redbusAPI.onChannelStatusChanged((data) => {
        setChannels(prev => prev.map(ch =>
          ch.id === data.channelId
            ? { ...ch, status: data.status as any, errorMessage: data.errorMessage }
            : ch
        ));
      });
    }

    if (window.redbusAPI?.onBriefingReady) {
      window.redbusAPI.onBriefingReady((data) => {
        setBriefing(data);
        setLoadingBriefing(false);
      });
    }

    if (window.redbusAPI?.onDraftsReady) {
      window.redbusAPI.onDraftsReady((data) => {
        setDrafts(data.drafts || []);
        setLoadingDrafts(false);
      });
    }
  }, []);

  const loadStatuses = useCallback(async () => {
    if (!window.redbusAPI) return;
    const res = await window.redbusAPI.getChannelStatuses();
    if (res.status === 'OK' && res.data) {
      setChannels(res.data);
    }
  }, []);

  const handleAuthenticate = useCallback(async (channelId: string) => {
    if (!window.redbusAPI) return;
    setChannels(prev => prev.map(ch =>
      ch.id === channelId ? { ...ch, status: 'authenticating' } : ch
    ));
    await window.redbusAPI.authenticateChannel(channelId);
    // Status will be updated via onChannelStatusChanged listener
  }, []);

  const handleDisconnect = useCallback(async (channelId: string) => {
    if (!window.redbusAPI) return;
    await window.redbusAPI.disconnectChannel(channelId);
    setChannels(prev => prev.map(ch =>
      ch.id === channelId ? { ...ch, status: 'disconnected', lastMessages: [], lastPollAt: null } : ch
    ));
  }, []);

  const handleTriggerBriefing = useCallback(async () => {
    if (!window.redbusAPI) return;
    setLoadingBriefing(true);
    const res = await window.redbusAPI.triggerBriefing();
    if (res.status === 'OK' && res.data) {
      setBriefing(res.data);
    }
    setLoadingBriefing(false);
  }, []);

  const handleGenerateDrafts = useCallback(async () => {
    if (!window.redbusAPI) return;
    setLoadingDrafts(true);
    const res = await window.redbusAPI.generateDraftReplies();
    if (res.status === 'OK' && res.data) {
      setDrafts(res.data);
    }
    setLoadingDrafts(false);
  }, []);

  const handleInjectDraft = useCallback(async (draft: DraftReply) => {
    if (!window.redbusAPI) return;
    setInjectingDraft(`${draft.channel}-${draft.sender}`);
    await window.redbusAPI.injectDraft(draft.channel, draft.sender, draft.draft);
    setInjectingDraft(null);
  }, []);

  const connectedCount = channels.filter(ch => ch.status === 'connected').length;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected': return <Wifi size={13} style={{ color: '#4ade80' }} />;
      case 'authenticating': return <Loader2 size={13} className="spinner" style={{ color: '#facc15' }} />;
      case 'extracting': return <Loader2 size={13} className="spinner" style={{ color: '#06b6d4' }} />;
      case 'error': return <AlertTriangle size={13} style={{ color: '#f87171' }} />;
      default: return <WifiOff size={13} style={{ color: 'var(--text-ghost)' }} />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'connected': return 'conectado';
      case 'authenticating': return 'autenticando...';
      case 'extracting': return 'extraindo...';
      case 'error': return 'erro';
      default: return 'desconectado';
    }
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'high': return '#f87171';
      case 'medium': return '#facc15';
      case 'low': return '#4ade80';
      default: return 'var(--text-dim)';
    }
  };

  const getUrgencyLabel = (urgency: string) => {
    switch (urgency) {
      case 'high': return '🔴 urgente';
      case 'medium': return '🟡 média';
      case 'low': return '🟢 baixa';
      default: return '⚪ desconhecida';
    }
  };

  return (
    <div className="settings-overlay">
      <div className="settings-container" style={{ maxWidth: '700px' }}>
        <header className="top-bar">
          <div>
            <h1><Mail size={16} style={{ display: 'inline', verticalAlign: 'sub', marginRight: '6px' }} /> inbox executiva</h1>
            <p className="subtitle">
              {connectedCount} / {channels.length} canais conectados
            </p>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              className="save-btn"
              onClick={handleTriggerBriefing}
              disabled={loadingBriefing || connectedCount === 0}
            >
              {loadingBriefing ? <Loader2 size={12} className="spinner" /> : <RefreshCcw size={12} />}
              <span style={{ marginLeft: '4px' }}>briefing</span>
            </button>
          </div>
        </header>

        {/* ── Channel Cards ── */}
        <section className="settings-section">
          <div className="section-head">
            <h3>canais de comunicação</h3>
            <p>clique em "autenticar" para fazer login manualmente. o redbus roda em background.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {channels.map(ch => (
              <div
                key={ch.id}
                id={`inbox-channel-${ch.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  background: 'var(--bg-surface)',
                  border: `1px solid ${ch.status === 'connected' ? CHANNEL_COLORS[ch.id] + '40' : 'var(--border)'}`,
                  borderRadius: '6px',
                  padding: '12px 16px',
                  transition: 'border-color 0.2s',
                }}
              >
                {/* Icon */}
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: `${CHANNEL_COLORS[ch.id]}20`,
                  color: CHANNEL_COLORS[ch.id],
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {CHANNEL_ICONS[ch.id]}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                      {ch.label}
                    </span>
                    {getStatusIcon(ch.status)}
                    <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                      {getStatusLabel(ch.status)}
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-ghost)', marginTop: '2px' }}>
                    {ch.lastPollAt
                      ? `última extração: ${new Date(ch.lastPollAt).toLocaleTimeString()} — ${ch.lastMessages?.length || 0} não lidas`
                      : ch.url
                    }
                  </div>
                  {ch.errorMessage && (
                    <div style={{ fontSize: '10px', color: '#f87171', marginTop: '2px' }}>
                      {ch.errorMessage}
                    </div>
                  )}
                </div>

                {/* Action button */}
                <div>
                  {ch.status === 'disconnected' || ch.status === 'error' ? (
                    <button
                      className="save-btn"
                      onClick={() => handleAuthenticate(ch.id)}
                      style={{ fontSize: '11px' }}
                      id={`inbox-auth-${ch.id}`}
                    >
                      autenticar
                    </button>
                  ) : ch.status === 'authenticating' ? (
                    <button className="save-btn" disabled style={{ fontSize: '11px' }}>
                      <Loader2 size={11} className="spinner" />
                    </button>
                  ) : (
                    <button
                      className="save-btn"
                      onClick={() => handleDisconnect(ch.id)}
                      style={{ fontSize: '11px', color: 'var(--red, #f87171)', borderColor: 'var(--red, #f87171)' }}
                      id={`inbox-disconnect-${ch.id}`}
                    >
                      desconectar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Briefing Panel ── */}
        {briefing && (
          <section className="settings-section">
            <div className="section-head">
              <h3>briefing executivo</h3>
              <p>
                {briefing.totalMessages} mensagens · {briefing.urgentCount} urgentes ·
                gerado às {new Date(briefing.generatedAt).toLocaleTimeString()}
              </p>
            </div>

            {/* Briefing text */}
            <div style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '12px 16px',
              fontSize: '12px',
              color: 'var(--text-primary)',
              lineHeight: '1.5',
              marginBottom: '8px',
            }}>
              {briefing.briefingText}
            </div>

            {/* Individual messages */}
            {briefing.messages.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '250px', overflowY: 'auto' }}>
                {briefing.messages.map((msg, i) => (
                  <div
                    key={`msg-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '8px 10px',
                      background: msg.urgency === 'high' ? '#f8717110' : 'var(--bg-surface)',
                      borderRadius: '4px',
                      border: `1px solid ${msg.urgency === 'high' ? '#f8717130' : 'var(--border)'}`,
                    }}
                  >
                    <div style={{
                      width: '24px', height: '24px', borderRadius: '6px',
                      background: `${CHANNEL_COLORS[msg.channel] || '#666'}20`,
                      color: CHANNEL_COLORS[msg.channel] || '#666',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, fontSize: '10px',
                    }}>
                      {CHANNEL_ICONS[msg.channel] || <Mail size={12} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text-primary)' }}>
                          {msg.sender}
                        </span>
                        <span style={{ fontSize: '9px', color: getUrgencyColor(msg.urgency) }}>
                          {getUrgencyLabel(msg.urgency)}
                        </span>
                      </div>
                      {msg.subject && (
                        <div style={{ fontSize: '10px', color: 'var(--accent)', marginTop: '1px' }}>
                          {msg.subject}
                        </div>
                      )}
                      <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {msg.preview}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Draft replies button */}
            {briefing.urgentCount > 0 && (
              <div style={{ marginTop: '10px' }}>
                <button
                  className="save-btn"
                  onClick={handleGenerateDrafts}
                  disabled={loadingDrafts}
                  style={{ fontSize: '11px' }}
                  id="inbox-generate-drafts"
                >
                  {loadingDrafts ? <Loader2 size={11} className="spinner" /> : <FileEdit size={11} />}
                  <span style={{ marginLeft: '4px' }}>rascunhar respostas urgentes</span>
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── Draft Replies Panel ── */}
        {drafts.length > 0 && (
          <section className="settings-section">
            <div className="section-head">
              <h3>rascunhos de resposta</h3>
              <p>clique em "injetar" para colar o rascunho no campo de texto. não será enviado automaticamente.</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {drafts.map((draft, i) => (
                <div
                  key={`draft-${i}`}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: '10px 14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ color: CHANNEL_COLORS[draft.channel] || '#666' }}>
                        {CHANNEL_ICONS[draft.channel] || <Mail size={12} />}
                      </div>
                      <span style={{ fontWeight: 600, fontSize: '11px' }}>{draft.sender}</span>
                    </div>
                    <button
                      className="save-btn"
                      onClick={() => handleInjectDraft(draft)}
                      disabled={injectingDraft === `${draft.channel}-${draft.sender}`}
                      style={{ fontSize: '10px' }}
                    >
                      {injectingDraft === `${draft.channel}-${draft.sender}`
                        ? <Loader2 size={10} className="spinner" />
                        : 'injetar'
                      }
                    </button>
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--text-dim)',
                    fontStyle: 'italic',
                    padding: '6px 8px',
                    background: 'var(--bg-deep, #0a0a0a)',
                    borderRadius: '4px',
                  }}>
                    "{draft.draft}"
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
