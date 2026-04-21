import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Trash2, Loader2 } from 'lucide-react';

interface DigestRow {
  id: string;
  digest_date: string;
  channel: string;
  total_messages: number;
  summary_json: string;
  generated_at: string;
}

interface Props {
  /** Refresh token — increment to force reload (e.g. after new digest generated). */
  refreshToken?: number;
  /** Click on a row → navigate to that date's digest tab. */
  onSelect?: (date: string, id: string) => void;
}

export const PreviousDigestsPanel: React.FC<Props> = ({ refreshToken, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DigestRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await window.redbusAPI.listDigests(30);
      if (r.status === 'OK' && Array.isArray(r.data)) setRows(r.data as DigestRow[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load, refreshToken]);

  const onDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await window.redbusAPI.deleteDigest(id);
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const fmtDate = (iso: string): string => {
    try { return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
    catch { return iso; }
  };

  return (
    <div className="comms-prev-digests">
      <button className="comms-prev-digests-header" onClick={() => setOpen(v => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <FileText size={12} />
        <span>digests anteriores</span>
        {rows.length > 0 && <span className="comms-prev-digests-count">{rows.length}</span>}
      </button>
      {open && (
        <div className="comms-prev-digests-body">
          {loading && <div className="comms-prev-digests-empty"><Loader2 size={12} className="spin" /> carregando...</div>}
          {!loading && rows.length === 0 && <div className="comms-prev-digests-empty">nenhum digest ainda</div>}
          {!loading && rows.map(row => (
            <div key={row.id} className="comms-prev-digests-row">
              <button
                className="comms-prev-digests-row-btn"
                onClick={() => onSelect?.(String(row.digest_date).slice(0, 10), row.id)}
                title="abrir digest"
              >
                <span className="comms-prev-digests-date">{fmtDate(String(row.digest_date).slice(0, 10))}</span>
                <span className="comms-prev-digests-meta">{row.total_messages} itens</span>
                <Trash2 size={11} className="comms-prev-digests-del" onClick={(e) => onDelete(row.id, e)} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

