import React, { useState, useEffect, useCallback } from 'react';
import { Mail, RefreshCw, Trash2, AlertTriangle, Clock, Zap, Wifi, WifiOff, Loader2, Hash, ListTodo } from 'lucide-react';
import { MiniCalendar } from '../Layout/MiniCalendar';

/* ── Types ── */
interface DigestRow {
  id: string; digest_date: string; channel: string;
  total_messages: number; summary_json: string; generated_at: string;
  raw_messages_json?: string;
}
interface DigestTopic {
  title: string; summary: string; priority: 'high' | 'medium' | 'low';
  messages: Array<{ sender: string; subject?: string; preview: string }>;
}
interface DigestSummary {
  executive_summary: string; topics: DigestTopic[];
  action_items: string[]; total_messages: number; channels: string[];
}

interface ChannelState { id: string; label: string; status: string; }

const CH_ICONS: Record<string, React.ReactNode> = { outlook: <Mail size={13} />, teams: <Hash size={13} /> };
const CH_COLORS: Record<string, string> = { outlook: '#0078d4', teams: '#6264a7' };

function jp<T>(json: string | null | undefined, fb: T): T { if (!json) return fb; try { return JSON.parse(json); } catch { return fb; } }
function fmtDate(d: string): string { try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); } catch { return d; } }
function today(): string { return new Date().toISOString().slice(0, 10); }


const PRIORITY_ICON: Record<string, React.ReactNode> = {
  high: <AlertTriangle size={11} style={{ color: '#ef4444' }} />,
  medium: <Zap size={11} style={{ color: '#f59e0b' }} />,
  low: <Mail size={11} style={{ color: 'var(--text-dim)' }} />,
};

/* ── Topic Card ── */
const TopicCard: React.FC<{ topic: DigestTopic; index: number }> = ({ topic, index }) => (
  <div className={`inbox-topic priority-${topic.priority}`}>
    <div className="inbox-topic-header">
      {PRIORITY_ICON[topic.priority] || PRIORITY_ICON.medium}
      <h4>{index + 1}. {topic.title}</h4>
      <span className={`inbox-priority-badge ${topic.priority}`}>{topic.priority}</span>
    </div>
    <p className="inbox-topic-summary">{topic.summary}</p>
    {topic.messages.length > 0 && (
      <ul className="inbox-topic-msgs">
        {topic.messages.map((m, i) => (
          <li key={i}><strong>{m.sender}</strong>{m.subject ? ` — ${m.subject}` : ''}: <span>{m.preview}</span></li>
        ))}
      </ul>
    )}
  </div>
);

/* ── Channel Bar ── */
const ChannelBar: React.FC<{
  channels: ChannelState[];
  onConnect: (id: string) => void;
}> = ({ channels, onConnect }) => (
  <div className="inbox-channels">
    {channels.map(ch => (
      <div
        key={ch.id}
        className={`inbox-ch-card ${ch.status}`}
        onClick={() => ch.status === 'disconnected' ? onConnect(ch.id) : undefined}
        title={ch.status === 'disconnected' ? `Conectar ao ${ch.label}` : ch.label}
      >
        <span className="inbox-ch-icon" style={{ color: CH_COLORS[ch.id] || 'var(--text-dim)' }}>{CH_ICONS[ch.id] || <Mail size={13} />}</span>
        <span className="inbox-ch-label">{ch.label}</span>
        <span className="inbox-ch-status">
          {ch.status === 'connected' && <><Wifi size={9} /> on</>}
          {ch.status === 'extracting' && <><Loader2 size={9} className="spin" /> extraindo</>}
          {ch.status === 'authenticating' && <><Loader2 size={9} className="spin" /> autenticando</>}
          {ch.status === 'disconnected' && <><WifiOff size={9} /> conectar</>}
          {ch.status === 'error' && <><AlertTriangle size={9} /> erro</>}
        </span>
      </div>
    ))}
  </div>
);

/* ── Main Component ── */
export const InboxView: React.FC = () => {
  const [digests, setDigests] = useState<DigestRow[]>([]);
  const [selectedDate, setSelectedDate] = useState(today());
  const [detail, setDetail] = useState<DigestRow | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<ChannelState[]>([]);

  const digestDates = new Set(digests.map(d => d.digest_date));

  const fetchDigests = useCallback(async () => {
    try {
      const res = await window.redbusAPI.listDigests(60);
      if (res.status === 'OK' && res.data) setDigests(res.data);
    } catch { } finally { setLoading(false); }
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await window.redbusAPI.getChannelStatuses();
      if (res.status === 'OK' && res.data) {
        const arr = Array.isArray(res.data) ? res.data : Object.entries(res.data).map(([id, info]: [string, any]) => ({ id, ...info }));
        setChannels(arr.map((ch: any) => ({ id: ch.id, label: ch.label || ch.id, status: ch.status || 'disconnected' })));
      }
    } catch { }
  }, []);

  useEffect(() => { fetchDigests(); fetchChannels(); }, [fetchDigests, fetchChannels]);

  // Listen for digest events (progress, completion, error)
  useEffect(() => {
    window.redbusAPI.onDigestProgress((step: string) => {
      setProgressStep(step);
      if (step.includes('navegando')) setProgressPercent(15);
      else if (step.includes('filtrando')) setProgressPercent(40);
      else if (step.includes('processando')) setProgressPercent(70);
      else if (step.includes('salvando')) setProgressPercent(90);
    });
    window.redbusAPI.onDigestComplete((_data: { date: string; id: string; summary: any }) => {
      setGenerating(false);
      setProgressStep('');
      setProgressPercent(0);
      fetchDigests();
    });
    window.redbusAPI.onDigestError((_data: { date: string; error: string }) => {
      setGenerating(false);
      setProgressStep('');
      setProgressPercent(0);
    });
  }, [fetchDigests]);

  // Poll channel statuses
  useEffect(() => {
    const interval = setInterval(fetchChannels, 5000);
    return () => clearInterval(interval);
  }, [fetchChannels]);

  const handleConnect = async (channelId: string) => {
    try {
      await window.redbusAPI.authenticateChannel(channelId);
      setTimeout(fetchChannels, 2000);
    } catch { }
  };

  // When selectedDate changes, load digest for that date
  useEffect(() => {
    const match = digests.find(d => d.digest_date === selectedDate);
    if (match) {
      window.redbusAPI.getDigestDetails(match.id).then(res => {
        if (res.status === 'OK' && res.data) setDetail(res.data);
      });
    } else {
      setDetail(null);
    }
  }, [selectedDate, digests]);

  const handleGenerate = async (date?: string) => {
    if (generating) return;
    const targetDate = date || selectedDate;
    if (targetDate > today()) return;
    setGenerating(true);
    setSelectedDate(targetDate);
    // Fire and forget — extraction runs in background
    // Progress comes via digest:progress events, completion via digest:complete
    try {
      await window.redbusAPI.generateDigest(targetDate);
    } catch {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await window.redbusAPI.deleteDigest(id);
      if (res.status === 'OK') {
        setDigests(prev => prev.filter(d => d.id !== id));
        if (detail?.id === id) setDetail(null);
      }
    } catch { }
  };

  const summary: DigestSummary | null = detail ? jp<DigestSummary | null>(detail.summary_json, null) : null;

  return (
    <div className="view-layout" data-testid="inbox-view">
      {/* Sidebar */}
      <aside className="view-sidebar">
        <div className="view-sidebar-header">
          <h2><Mail size={16} style={{ display: 'inline', verticalAlign: 'sub', marginRight: '6px' }} /> comunicações</h2>
          <button className={`mtg-sync-btn${generating ? ' syncing' : ''}`} onClick={() => handleGenerate()} disabled={generating || selectedDate > today()} title={`Gerar digest para ${selectedDate}`} data-testid="digest-generate-btn">
            <RefreshCw size={13} className={generating ? 'spin' : ''} />
          </button>
        </div>
        {channels.length > 0 && <ChannelBar channels={channels} onConnect={handleConnect} />}
        <MiniCalendar selectedDate={selectedDate} activeDates={digestDates} onSelect={setSelectedDate} />
        <div className="view-sidebar-list" style={{ borderTop: '1px solid var(--border)' }}>
          {loading ? <p className="view-empty">carregando...</p>
            : digests.length === 0 ? <p className="view-empty">nenhum digest gerado.<br />Clique ↻ para gerar.</p>
              : digests.map(d => (
                <div key={d.id} className={`view-sidebar-item${d.digest_date === selectedDate ? ' active' : ''}`}
                  onClick={() => setSelectedDate(d.digest_date)} data-testid="digest-sidebar-item">
                  <div className="view-sidebar-item-title">{fmtDate(d.digest_date)}</div>
                  <div className="view-sidebar-item-meta">
                    <span><Clock size={9} /> {d.generated_at ? new Date(d.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  </div>
                </div>
              ))}
        </div>
      </aside>

      {/* Detail */}
      <main className="view-detail">
        {!summary ? (
          <div className="view-detail-empty">
            <Mail size={32} strokeWidth={1} />
            {generating && progressStep ? (
              <div className="inbox-progress-container">
                <Loader2 size={24} className="spin" style={{ color: 'var(--accent)', marginBottom: 16 }} />
                <div className="redbus-progress-bar">
                  <div className="redbus-progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
                <p className="inbox-progress-text">{progressStep}</p>
                <span className="inbox-progress-pct">{progressPercent}%</span>
              </div>
            ) : (
              <>
                <p>{digestDates.has(selectedDate) ? 'carregando...' : `nenhum digest para ${fmtDate(selectedDate)}`}</p>
                {!digestDates.has(selectedDate) && selectedDate <= today() && (
                  <button className="inbox-gen-btn" onClick={() => handleGenerate(selectedDate)} disabled={generating}>
                    {selectedDate === today() ? 'gerar digest de hoje' : `gerar digest de ${fmtDate(selectedDate)}`}
                  </button>
                )}
                {selectedDate > today() && (
                  <p style={{ fontSize: '10px', color: 'var(--text-ghost)', marginTop: 8 }}>data futura — não é possível gerar digest</p>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            <header className="view-detail-header">
              <div className="view-detail-title-row">
                <h1>{fmtDate(selectedDate)}</h1>
                {detail && (
                  <button className="view-delete-btn" onClick={() => handleDelete(detail.id)} title="Excluir digest">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className="view-detail-meta">
                <span><Clock size={11} /> gerado em {detail?.generated_at ? new Date(detail.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                {selectedDate <= today() && (
                  <button className="inbox-refresh-link" onClick={() => handleGenerate(selectedDate)} disabled={generating}>
                    <RefreshCw size={10} className={generating ? 'spin' : ''} /> {generating && progressStep ? progressStep : 'atualizar'}
                  </button>
                )}
              </div>
            </header>

            <div className="view-content">
              {/* Executive summary */}
              <div className="inbox-exec-summary">
                <p>{summary.executive_summary}</p>
              </div>

              {/* Action items */}
              {summary.action_items?.length > 0 && (
                <div className="mtg-section">
                  <h4>Itens de Ação</h4>
                  <ul className="mtg-action-list">
                    {summary.action_items.map((a, i) => (
                      <li key={i}>
                        <input type="checkbox" disabled className="mtg-checkbox" />
                        <span>{a}</span>
                        <button
                          className="inbox-add-todo-btn"
                          onClick={async () => {
                            try {
                              await window.redbusAPI.createTodo({ content: a });
                            } catch { }
                          }}
                          title="Adicionar ao To-Do"
                        >
                          <ListTodo size={9} /> to-do
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Topics */}
              {summary.topics?.length > 0 && (
                <div className="inbox-topics">
                  {summary.topics.map((t, i) => <TopicCard key={i} topic={t} index={i} />)}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

