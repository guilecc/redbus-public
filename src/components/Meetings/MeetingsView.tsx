import React, { useState, useEffect, useCallback } from 'react';
import { Video, Clock, Users, ExternalLink, Mic, Cloud, FileText, MessageSquare, RefreshCw, Trash2 } from 'lucide-react';
import { MiniCalendar } from '../Layout/MiniCalendar';

/* ── Types ── */
interface MeetingRow {
  id: string; timestamp: string; provider_used: string;
  title: string | null; meeting_date: string | null; duration_seconds: number | null;
  platform: string | null; external_id: string | null; speakers_json: string | null;
  highlights_json: string | null; transcript_json: string | null;
  status: string | null; meeting_url: string | null; summary_json: string | null;
  raw_transcript?: string | null;
}
interface TranscriptEntry { speaker: string; text: string; startTime: number; endTime: number; }
interface Highlight {
  text: string; speaker?: string | null; startTime?: number | null;
  source?: string | null; topic?: { title: string; summary?: string } | null;
}

/* ── Helpers ── */
function fmtDur(s: number | null): string { if (!s) return '—'; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}min` : `${m}min`; }
function fmtTs(s: number): string { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
function fmtDate(iso: string | null): string { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } }
function fmtDateShort(iso: string | null): string { if (!iso) return ''; try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }); } catch { return ''; } }
function jp<T>(json: string | null, fb: T): T { if (!json) return fb; try { return JSON.parse(json); } catch { return fb; } }
function today(): string { return new Date().toISOString().slice(0, 10); }

const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];
function spkColor(name: string, all: string[]): string { const i = all.indexOf(name); return COLORS[i >= 0 ? i % COLORS.length : 0]; }

/* ── Sub-components ── */

/** Group highlights by topic.title, preserving insertion order */
function groupByTopic(highlights: Highlight[]): Array<{ title: string; items: Highlight[] }> {
  const map = new Map<string, Highlight[]>();
  for (const h of highlights) {
    const key = h.topic?.title || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(h);
  }
  return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
}

const NotesPanel: React.FC<{ summary: any; highlights: Highlight[] }> = ({ summary, highlights }) => {
  const grouped = groupByTopic(highlights);
  const hasTopics = grouped.length > 0 && grouped.some(g => g.title !== '');
  const hasContent = summary.executive_summary || summary.action_items?.length || summary.decisions?.length || highlights.length > 0;

  if (!hasContent) return <p className="mtg-empty-detail">nenhuma nota disponível para esta reunião.</p>;

  return (
    <div className="mtg-notes-panel">
      {/* tl;dv-style: topics with numbered sections */}
      {hasTopics ? grouped.map((group, gi) => (
        <div key={gi} className="mtg-topic-section">
          {group.title && <h3 className="mtg-topic-title">{gi + 1}. {group.title}</h3>}
          <ul className="mtg-topic-items">
            {group.items.map((h, hi) => (
              <li key={hi} className="mtg-topic-item">
                <input type="checkbox" disabled className="mtg-checkbox" />
                <span className="mtg-topic-item-text">{h.text}</span>
                {h.startTime != null && h.startTime > 0 && (
                  <span className="mtg-hl-time">{fmtTs(h.startTime)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )) : (
        <>
          {/* Fallback: flat highlights (local recordings or no topics) */}
          {highlights.length > 0 && (
            <div className="mtg-section">
              <h4>Destaques</h4>
              <ul className="mtg-highlights-list">{highlights.map((h, i) => (
                <li key={i}>
                  {h.speaker && <span className="mtg-hl-speaker">{h.speaker}</span>}
                  <span>{h.text}</span>
                  {h.startTime != null && h.startTime > 0 && <span className="mtg-hl-time">{fmtTs(h.startTime)}</span>}
                </li>
              ))}</ul>
            </div>
          )}
        </>
      )}

      {/* Summary sections (from local recordings / LLM analysis) */}
      {summary.executive_summary && <div className="mtg-section"><h4>Resumo</h4><p>{summary.executive_summary}</p></div>}
      {summary.decisions?.length > 0 && (
        <div className="mtg-section"><h4>Decisões</h4><ul>{summary.decisions.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul></div>
      )}
      {summary.action_items?.length > 0 && (
        <div className="mtg-section">
          <h4>Itens de Ação</h4>
          <ul className="mtg-action-list">{summary.action_items.map((a: any, i: number) => (
            <li key={i}><input type="checkbox" disabled className="mtg-checkbox" /><span>{typeof a === 'string' ? a : `${a.owner ? a.owner + ': ' : ''}${a.task}`}</span></li>
          ))}</ul>
        </div>
      )}
    </div>
  );
};

const TranscriptPanel: React.FC<{ entries: TranscriptEntry[]; speakerNames: string[] }> = ({ entries, speakerNames }) => {
  if (entries.length === 0) return <p className="mtg-empty-detail">transcrição não disponível.</p>;
  let lastSpeaker = '';
  return (
    <div className="mtg-transcript-panel">
      {entries.map((e, i) => {
        const showHeader = e.speaker !== lastSpeaker;
        lastSpeaker = e.speaker;
        return (
          <div key={i} className="mtg-tx-entry">
            {showHeader && (
              <div className="mtg-tx-speaker" style={{ color: spkColor(e.speaker, speakerNames) }}>
                {e.speaker}
              </div>
            )}
            <div className="mtg-tx-text">{e.text}</div>
          </div>
        );
      })}
    </div>
  );
};

/* ── Main Component ── */
interface MeetingsViewProps {
  initialMeetingId?: string | null;
  onMeetingSelected?: () => void;
}

export const MeetingsView: React.FC<MeetingsViewProps> = ({ initialMeetingId, onMeetingSelected }) => {
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MeetingRow | null>(null);
  const [detailTab, setDetailTab] = useState<'notes' | 'transcript'>('notes');
  const [syncing, setSyncing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today());

  const fetchMeetings = useCallback(async () => {
    try {
      const res = await window.redbusAPI.listMeetings(100, 0);
      if (res.status === 'OK' && res.data) {
        setMeetings(res.data);
        // If an initial meeting ID was provided, select it; otherwise select the first
        const targetId = initialMeetingId || (res.data.length > 0 ? res.data[0].id : null);
        if (targetId) {
          selectMeeting(targetId);
          const match: any = res.data.find((m: any) => m.id === targetId);
          if (match) setSelectedDate((match.meeting_date || match.timestamp).slice(0, 10));
        }
        if (initialMeetingId && onMeetingSelected) onMeetingSelected();
      }
    } catch (e) { console.error('[MeetingsView] fetch:', e); }
    finally { setLoading(false); }
  }, [initialMeetingId]);

  useEffect(() => { fetchMeetings(); }, [fetchMeetings]);

  const selectMeeting = async (id: string) => {
    setSelectedId(id); setDetail(null);
    try { const r = await window.redbusAPI.getMeetingDetails(id); if (r.status === 'OK' && r.data) setDetail(r.data); } catch { }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await Promise.race([
        window.redbusAPI.forceTldvSync(),
        new Promise((_, rej) => setTimeout(() => rej('timeout'), 30_000)),
      ]);
      await fetchMeetings();
    } catch { }
    finally { setSyncing(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await window.redbusAPI.deleteMeeting(id);
      if (res.status === 'OK') {
        setMeetings(prev => prev.filter(m => m.id !== id));
        if (selectedId === id) { setSelectedId(null); setDetail(null); }
      }
    } catch { }
  };

  const summary = jp<any>(detail?.summary_json || null, {});
  const highlights: Highlight[] = jp(detail?.highlights_json || null, []);
  const transcript: TranscriptEntry[] = jp(detail?.transcript_json || null, []);
  const speakers: Array<{ name: string }> = jp(detail?.speakers_json || null, []);
  const txEntries: TranscriptEntry[] = transcript.length > 0 ? transcript
    : (detail?.raw_transcript || '').split('\n').filter(Boolean).map(l => {
      const m = l.match(/^\[(.+?)\]\s*(.*)/);
      return m ? { speaker: m[1], text: m[2], startTime: 0, endTime: 0 } : { speaker: '', text: l, startTime: 0, endTime: 0 };
    });
  const spkNames = [...new Set(txEntries.map(t => t.speaker).filter(Boolean))];
  if (spkNames.length === 0) speakers.forEach(s => { if (!spkNames.includes(s.name)) spkNames.push(s.name); });

  return (
    <div className="view-layout" data-testid="meetings-view">
      {/* Sidebar */}
      <aside className="view-sidebar">
        <div className="view-sidebar-header">
          <h2><Video size={16} style={{ display: 'inline', verticalAlign: 'sub', marginRight: '6px' }} /> reuniões</h2>
          <button className={`mtg-sync-btn${syncing ? ' syncing' : ''}`} onClick={handleSync} disabled={syncing} title="Sincronizar tl;dv" data-testid="mtg-sync-btn">
            <RefreshCw size={13} className={syncing ? 'spin' : ''} />
          </button>
        </div>
        <MiniCalendar selectedDate={selectedDate} activeDates={new Set(meetings.map(m => (m.meeting_date || m.timestamp).slice(0, 10)))} onSelect={setSelectedDate} />
        <div className="view-sidebar-list">
          {loading ? <p className="view-empty">carregando...</p>
            : meetings.filter(m => (m.meeting_date || m.timestamp).startsWith(selectedDate)).length === 0 ? <p className="view-empty">nenhuma reunião em {fmtDateShort(selectedDate)}</p>
              : meetings.filter(m => (m.meeting_date || m.timestamp).startsWith(selectedDate)).map(m => {
                const mSpk = jp<Array<{ name: string }>>(m.speakers_json, []);
                const mSum = jp<any>(m.summary_json, {});
                return (
                  <div key={m.id} className={`view-sidebar-item${selectedId === m.id ? ' active' : ''}`}
                    onClick={() => selectMeeting(m.id)} data-testid="meeting-sidebar-item">
                    <div className="view-sidebar-item-title">{m.title || mSum.title || 'Sem título'}</div>
                    <div className="view-sidebar-item-meta">
                      <span>{fmtDateShort(m.meeting_date || m.timestamp)}</span>
                      <span>{fmtDur(m.duration_seconds)}</span>
                      <span className={`mtg-source-dot ${m.provider_used === 'tldv' ? 'dot-tldv' : 'dot-local'}`} />
                    </div>
                    {mSpk.length > 0 && (
                      <div className="view-sidebar-item-speakers">
                        {mSpk.slice(0, 3).map((s, i) => <span key={i} className="mtg-speaker-pill">{s.name?.split(' ')[0]}</span>)}
                        {mSpk.length > 3 && <span className="mtg-speaker-pill more">+{mSpk.length - 3}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
        </div>
      </aside>
      {/* Detail */}
      <main className="view-detail">
        {!detail ? (
          <div className="view-detail-empty"><Video size={32} strokeWidth={1} /><p>selecione uma reunião</p></div>
        ) : (<>
          <header className="view-detail-header">
            <div className="view-detail-title-row">
              <h1>{detail.title || summary.title || 'Sem título'}</h1>
              <span className={`meeting-badge ${detail.provider_used === 'tldv' ? 'badge-tldv' : 'badge-local'}`}>
                {detail.provider_used === 'tldv' ? <><Cloud size={9} /> tl;dv</> : <><Mic size={9} /> Local</>}
              </span>
              {detail.platform && detail.platform !== 'local' && <span className="meeting-badge badge-platform">{detail.platform}</span>}
              {detail.meeting_url && <a href={detail.meeting_url} target="_blank" rel="noreferrer" className="view-ext-link"><ExternalLink size={12} /></a>}
              <button className="view-delete-btn" onClick={() => handleDelete(detail.id)} title="Excluir reunião" data-testid="view-delete-btn">
                <Trash2 size={13} />
              </button>
            </div>
            <div className="view-detail-meta">
              <span><Clock size={11} /> {fmtDate(detail.meeting_date || detail.timestamp)}</span>
              <span>{fmtDur(detail.duration_seconds)}</span>
              {speakers.length > 0 && <span><Users size={11} /> {speakers.map(s => s.name).join(', ')}</span>}
            </div>
          </header>
          <div className="view-tabs">
            <button className={`view-tab${detailTab === 'notes' ? ' active' : ''}`} onClick={() => setDetailTab('notes')}><FileText size={12} /> Notas</button>
            <button className={`view-tab${detailTab === 'transcript' ? ' active' : ''}`} onClick={() => setDetailTab('transcript')}><MessageSquare size={12} /> Transcrição</button>
          </div>
          <div className="view-content">
            {detailTab === 'notes' ? <NotesPanel summary={summary} highlights={highlights} /> : <TranscriptPanel entries={txEntries} speakerNames={spkNames} />}
          </div>
        </>)}
      </main>
    </div>
  );
};

