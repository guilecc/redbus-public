import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ClipboardList, UserRound, Pin } from 'lucide-react';

interface MeetingReviewProps {
  data: {
    raw_transcript: string;
    summary_json: {
      executive_summary: string;
      decisions: string[];
      action_items: { owner: string; task: string; deadline?: string | null }[];
      speakers?: string[];
      duration?: number;
      highlights?: { text: string; speaker?: string; type?: string }[];
    };
    provider_used: string;
  };
  onSave: () => void;
  onDiscard: () => void;
}

interface SpeakerAnnotation {
  start: number;
  end: number;
  speaker: string;
}

interface ToolbarState {
  visible: boolean;
  x: number;
  y: number;
  selectedText: string;
  showSpeakerInput: boolean;
}

/**
 * MeetingReview — Interactive "Ata Viva" split view.
 * Left: annotatable transcript. Right: editable summary fields.
 * Footer: Confirm + Save / Discard buttons.
 */
export const MeetingReview: React.FC<MeetingReviewProps> = ({ data, onSave, onDiscard }) => {
  // ── Editable summary state ──
  const [summary, setSummary] = useState(data.summary_json.executive_summary || '');
  const [decisions, setDecisions] = useState<string[]>(data.summary_json.decisions || []);
  const [actionItems, setActionItems] = useState<{ owner: string; task: string; deadline?: string | null }[]>(
    data.summary_json.action_items || []
  );
  const [speakers, setSpeakers] = useState<string[]>(data.summary_json.speakers || []);
  const [highlights, setHighlights] = useState<{ text: string; speaker?: string; type?: string }[]>(
    data.summary_json.highlights || []
  );

  // ── Transcript annotations ──
  const [annotations, setAnnotations] = useState<SpeakerAnnotation[]>([]);
  const [toolbar, setToolbar] = useState<ToolbarState>({
    visible: false, x: 0, y: 0, selectedText: '', showSpeakerInput: false,
  });
  const speakerInputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  // ── Close toolbar on outside click ──
  useEffect(() => {
    const handler = () => setToolbar(t => ({ ...t, visible: false, showSpeakerInput: false }));
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Text selection handler (Notion-style pop-up) ──
  const handleTextSelect = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      return;
    }
    const text = sel.toString().trim();
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    setToolbar({
      visible: true,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      selectedText: text,
      showSpeakerInput: false,
    });
  }, []);

  // ── Toolbar actions ──
  const assignSpeaker = useCallback((name: string) => {
    if (!name.trim()) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    // Find offset in transcript text
    const container = transcriptRef.current;
    if (!container) return;
    const preRange = document.createRange();
    preRange.setStart(container, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + toolbar.selectedText.length;
    setAnnotations(prev => [...prev, { start, end, speaker: name.trim() }]);
    setToolbar(t => ({ ...t, visible: false, showSpeakerInput: false }));
    sel.removeAllRanges();
  }, [toolbar.selectedText]);

  const markAsDecision = useCallback(() => {
    setDecisions(prev => [...prev, toolbar.selectedText]);
    setToolbar(t => ({ ...t, visible: false }));
    window.getSelection()?.removeAllRanges();
  }, [toolbar.selectedText]);

  const markAsActionItem = useCallback(() => {
    setActionItems(prev => [...prev, { owner: '', task: toolbar.selectedText, deadline: null }]);
    setToolbar(t => ({ ...t, visible: false }));
    window.getSelection()?.removeAllRanges();
  }, [toolbar.selectedText]);

  // ── Render transcript with speaker annotations ──
  const renderTranscript = useCallback(() => {
    const text = data.raw_transcript;
    if (annotations.length === 0) return text;

    const sorted = [...annotations].sort((a, b) => a.start - b.start);
    const parts: React.ReactNode[] = [];
    let cursor = 0;

    sorted.forEach((ann, i) => {
      if (ann.start > cursor) parts.push(text.slice(cursor, ann.start));
      parts.push(
        <React.Fragment key={i}>
          <span className="mr-speaker-tag">{ann.speaker}</span>
          {text.slice(ann.start, ann.end)}
        </React.Fragment>
      );
      cursor = ann.end;
    });
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
  }, [data.raw_transcript, annotations]);

  // ── Save handler ──
  const handleSave = async () => {
    setSaving(true);
    const finalSummary = {
      executive_summary: summary,
      decisions,
      action_items: actionItems,
      speakers,
      highlights,
      duration: data.summary_json.duration || 0,
    };
    // Enrich transcript with speaker tags
    let enrichedTranscript = data.raw_transcript;
    const sorted = [...annotations].sort((a, b) => b.start - a.start);
    sorted.forEach(ann => {
      enrichedTranscript = enrichedTranscript.slice(0, ann.start) +
        `[${ann.speaker}] ` + enrichedTranscript.slice(ann.start);
    });

    await window.redbusAPI.saveMeetingReview({
      raw_transcript: enrichedTranscript,
      summary_json: finalSummary,
      provider_used: data.provider_used,
    });
    setSaving(false);
    onSave();
  };

  return (
    <div className="meeting-review">
      {/* ── Header ── */}
      <div className="meeting-review-header">
        <h2><ClipboardList size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '6px' }} />Revisão da Ata (Ata Viva)</h2>
        <span style={{ fontSize: '10px', opacity: 0.5 }}>Processado via {data.provider_used}</span>
      </div>

      {/* ── Split View ── */}
      <div className="meeting-review-split">
        {/* ── Left: Transcript ── */}
        <div className="mr-transcript" ref={transcriptRef} onMouseUp={handleTextSelect}>
          <div className="mr-transcript-title">transcrição bruta</div>
          {renderTranscript()}
        </div>

        {/* ── Right: Summary (editable) ── */}
        <div className="mr-summary">
          <div className="mr-summary-title">resumo da ia (editável)</div>

          {/* Executive Summary */}
          <div className="mr-field">
            <div className="mr-field-label">resumo executivo</div>
            <textarea className="mr-textarea" value={summary} onChange={e => setSummary(e.target.value)} rows={3} />
          </div>

          {/* Decisions */}
          <div className="mr-field">
            <div className="mr-field-label">decisões ({decisions.length})</div>
            {decisions.map((d, i) => (
              <div key={i} className="mr-list-item">
                <input type="text" value={d} onChange={e => { const v = [...decisions]; v[i] = e.target.value; setDecisions(v); }} />
                <button className="mr-remove-btn" onClick={() => setDecisions(decisions.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="mr-add-btn" onClick={() => setDecisions([...decisions, ''])}>+ adicionar decisão</button>
          </div>

          {/* Action Items */}
          <div className="mr-field">
            <div className="mr-field-label">action items ({actionItems.length})</div>
            {actionItems.map((ai, i) => (
              <div key={i} className="mr-list-item" style={{ flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
                  <input type="text" placeholder="Responsável" value={ai.owner} style={{ width: '80px' }}
                    onChange={e => { const v = [...actionItems]; v[i] = { ...v[i], owner: e.target.value }; setActionItems(v); }} />
                  <input type="text" placeholder="Tarefa" value={ai.task} style={{ flex: 1 }}
                    onChange={e => { const v = [...actionItems]; v[i] = { ...v[i], task: e.target.value }; setActionItems(v); }} />
                  <button className="mr-remove-btn" onClick={() => setActionItems(actionItems.filter((_, j) => j !== i))}>✕</button>
                </div>
              </div>
            ))}
            <button className="mr-add-btn" onClick={() => setActionItems([...actionItems, { owner: '', task: '', deadline: null }])}>+ adicionar item</button>
          </div>

          {/* Speakers */}
          <div className="mr-field">
            <div className="mr-field-label">locutores</div>
            {speakers.map((s, i) => (
              <div key={i} className="mr-list-item">
                <input type="text" value={s} onChange={e => { const v = [...speakers]; v[i] = e.target.value; setSpeakers(v); }} />
                <button className="mr-remove-btn" onClick={() => setSpeakers(speakers.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="mr-add-btn" onClick={() => setSpeakers([...speakers, ''])}>+ adicionar locutor</button>
          </div>

          {/* Highlights */}
          <div className="mr-field">
            <div className="mr-field-label">highlights ({highlights.length})</div>
            {highlights.map((h, i) => (
              <div key={i} className="mr-list-item" style={{ flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
                  <input type="text" placeholder="Locutor" value={h.speaker || ''} style={{ width: '80px' }}
                    onChange={e => { const v = [...highlights]; v[i] = { ...v[i], speaker: e.target.value }; setHighlights(v); }} />
                  <input type="text" placeholder="Highlight" value={h.text} style={{ flex: 1 }}
                    onChange={e => { const v = [...highlights]; v[i] = { ...v[i], text: e.target.value }; setHighlights(v); }} />
                  <button className="mr-remove-btn" onClick={() => setHighlights(highlights.filter((_, j) => j !== i))}>✕</button>
                </div>
              </div>
            ))}
            <button className="mr-add-btn" onClick={() => setHighlights([...highlights, { text: '', speaker: '', type: 'note' }])}>+ adicionar highlight</button>
          </div>
        </div>
      </div>

      {/* ── Floating Toolbar (Notion-style) ── */}
      {toolbar.visible && (
        <div
          className="mr-floating-toolbar"
          style={{ left: toolbar.x, top: toolbar.y, transform: 'translate(-50%, -100%)' }}
          onMouseDown={e => e.stopPropagation()}
        >
          {toolbar.showSpeakerInput ? (
            <form onSubmit={e => { e.preventDefault(); assignSpeaker(speakerInputRef.current?.value || ''); }} style={{ display: 'flex', gap: '4px' }}>
              <input ref={speakerInputRef} className="mr-speaker-input" placeholder="Nome do locutor" autoFocus />
              <button type="submit" className="mr-toolbar-btn speaker">OK</button>
            </form>
          ) : (
            <>
              <button className="mr-toolbar-btn speaker" onClick={() => { setToolbar(t => ({ ...t, showSpeakerInput: true })); }}>
                <UserRound size={12} /> Locutor
              </button>
              <button className="mr-toolbar-btn decision" onClick={markAsDecision}>
                ✅ Decisão
              </button>
              <button className="mr-toolbar-btn action" onClick={markAsActionItem}>
                <Pin size={12} /> Action Item
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="meeting-review-footer">
        <button className="mr-discard-btn" onClick={onDiscard}>Descartar</button>
        <button className="mr-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando...' : '✓ Confirmar e Salvar na Memória'}
        </button>
      </div>
    </div>
  );
};

