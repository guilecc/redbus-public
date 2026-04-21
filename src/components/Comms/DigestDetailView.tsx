import React, { useEffect, useState } from 'react';
import { Mail, AlertTriangle, Zap, ListTodo, Trash2, Clock, RefreshCw, Loader2 } from 'lucide-react';

interface DigestTopic {
  title: string;
  summary: string;
  priority: 'high' | 'medium' | 'low';
  addressing?: 'direct' | 'cc' | 'mention' | 'broadcast' | 'unknown';
  messages: Array<{ sender: string; subject?: string; preview: string }>;
}
interface DigestSummary {
  executive_summary: string;
  topics: DigestTopic[];
  action_items: string[];
  total_messages: number;
  channels: string[];
}

interface Props {
  date: string;                // YYYY-MM-DD
  digestId?: string;           // when present, loads from backend
  onDelete?: (id: string) => void;
  onGenerate?: () => void;
  generating?: boolean;
  progressMessage?: string;
  canGenerate?: boolean;
  blockReason?: string;
}

function fmtDate(d: string): string { try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); } catch { return d; } }
function jp<T>(json: string | null | undefined, fb: T): T { if (!json) return fb; try { return JSON.parse(json); } catch { return fb; } }
function today(): string { return new Date().toISOString().slice(0, 10); }

const PRIO_ICON: Record<string, React.ReactNode> = {
  high: <AlertTriangle size={11} style={{ color: '#ef4444' }} />,
  medium: <Zap size={11} style={{ color: '#f59e0b' }} />,
  low: <Mail size={11} style={{ color: 'var(--text-dim)' }} />,
};

const TopicCard: React.FC<{ topic: DigestTopic; index: number }> = ({ topic, index }) => (
  <div className={`inbox-topic priority-${topic.priority}`}>
    <div className="inbox-topic-header">
      {PRIO_ICON[topic.priority] || PRIO_ICON.medium}
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

export const DigestDetailView: React.FC<Props> = ({ date, digestId, onDelete, onGenerate, generating, progressMessage, canGenerate, blockReason }) => {
  const [detail, setDetail] = useState<{ id: string; generated_at: string; summary_json: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [todoBusy, setTodoBusy] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancel = false;
    setDetail(null);
    if (!digestId) return;
    setLoading(true);
    window.redbusAPI.getDigestDetails(digestId).then(res => {
      if (cancel) return;
      if (res.status === 'OK' && res.data) setDetail(res.data as any);
    }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [digestId]);

  const summary = detail ? jp<DigestSummary | null>(detail.summary_json, null) : null;

  const addTodo = async (idx: number, content: string) => {
    setTodoBusy(prev => new Set(prev).add(idx));
    try { await window.redbusAPI.createTodo({ content, target_date: date }); }
    finally { setTodoBusy(prev => { const n = new Set(prev); n.delete(idx); return n; }); }
  };

  if (!digestId) {
    return (
      <div className="view-detail-empty comms-digest-empty">
        <Mail size={32} strokeWidth={1} />
        {generating ? (
          <div className="inbox-progress-container">
            <Loader2 size={24} className="spin" style={{ color: 'var(--accent)', marginBottom: 16 }} />
            <p className="inbox-progress-text">{progressMessage || 'gerando...'}</p>
          </div>
        ) : (
          <>
            <p>nenhum digest para {fmtDate(date)}</p>
            {date <= today() && (
              <>
                <button className="inbox-gen-btn" onClick={onGenerate} disabled={generating || !canGenerate} title={!canGenerate ? blockReason : undefined}>
                  {date === today() ? 'gerar digest de hoje' : `gerar digest de ${fmtDate(date)}`}
                </button>
                {!canGenerate && blockReason && <p style={{ fontSize: 10, color: 'var(--text-ghost)', marginTop: 8 }}>{blockReason}</p>}
              </>
            )}
            {date > today() && <p style={{ fontSize: 10, color: 'var(--text-ghost)', marginTop: 8 }}>data futura — não é possível gerar digest</p>}
          </>
        )}
      </div>
    );
  }

  if (loading || !summary) {
    return <div className="view-detail-empty"><Loader2 size={20} className="spin" /><p>carregando digest...</p></div>;
  }

  return (
    <div className="comms-digest-detail">
      <header className="view-detail-header">
        <div className="view-detail-title-row">
          <h1>{fmtDate(date)}</h1>
          {detail && onDelete && (
            <button className="view-delete-btn" onClick={() => onDelete(detail.id)} title="Excluir digest"><Trash2 size={13} /></button>
          )}
        </div>
        <div className="view-detail-meta">
          <span><Clock size={11} /> gerado em {detail?.generated_at ? new Date(detail.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          {date <= today() && onGenerate && (
            <button className="inbox-refresh-link" onClick={onGenerate} disabled={generating || !canGenerate} title={!canGenerate ? blockReason : undefined}>
              <RefreshCw size={10} className={generating ? 'spin' : ''} /> {generating && progressMessage ? progressMessage : 'regerar'}
            </button>
          )}
        </div>
      </header>
      <div className="view-content">
        <div className="inbox-exec-summary"><p>{summary.executive_summary}</p></div>
        {summary.action_items?.length > 0 && (
          <div className="mtg-section">
            <h4>Itens de Ação</h4>
            <ul className="mtg-action-list">
              {summary.action_items.map((a, i) => (
                <li key={i}>
                  <input type="checkbox" disabled className="mtg-checkbox" />
                  <span>{a}</span>
                  <button className="inbox-add-todo-btn" onClick={() => addTodo(i, a)} disabled={todoBusy.has(i)} title="Adicionar ao To-Do">
                    <ListTodo size={9} /> to-do
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary.topics?.length > 0 && (
          <div className="inbox-topics">
            {summary.topics.map((t, i) => <TopicCard key={i} topic={t} index={i} />)}
          </div>
        )}
      </div>
    </div>
  );
};

