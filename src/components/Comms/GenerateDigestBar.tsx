import React from 'react';
import { Brain, Loader2, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { QueueItem } from './CommunicationHub';

interface Props {
  total: number;
  selected: number;
  busy: boolean;
  progressMessage?: string;
  blockReason?: string;
  onGenerate: () => void;
  onQueue?: () => void;
  queueItems?: QueueItem[];
  onClearFinished?: () => void;
}

export const GenerateDigestBar: React.FC<Props> = ({
  total, selected, busy, progressMessage, blockReason, onGenerate,
  queueItems = [], onClearFinished,
}) => {
  const disabled = busy || selected === 0 || !!blockReason;
  const tooltip = blockReason
    ? blockReason
    : selected === 0
      ? 'selecione ao menos uma comunicação'
      : `gerar digest com ${selected} ${selected === 1 ? 'item' : 'itens'}`;

  const pendingCount = queueItems.filter(x => x.status === 'queued' || x.status === 'generating').length;
  const hasFinished = queueItems.some(x => x.status === 'done' || x.status === 'error');
  const generatingItem = queueItems.find(x => x.status === 'generating');

  return (
    <div className="comms-digestbar">
      {/* Left: selection count + progress */}
      <div className="comms-digestbar-info">
        <span className="comms-digestbar-count">{selected} / {total} selecionados</span>
        {busy && progressMessage && (
          <span className="comms-digestbar-progress"><Loader2 size={11} className="spin" /> {progressMessage}</span>
        )}
        {blockReason && !busy && <span className="comms-digestbar-block">{blockReason}</span>}
      </div>

      {/* Center: queue — always visible */}
      <div className="comms-digestbar-queue">
        <span className="comms-digestbar-queue-label">
          <Clock size={11} />
          fila
          {pendingCount > 0 && <span className="comms-queue-badge">{pendingCount}</span>}
        </span>
        <div className="comms-digestbar-queue-chips">
          {queueItems.length === 0 && (
            <span className="comms-queue-dim" style={{ fontSize: '10px' }}>—</span>
          )}
          {queueItems.map(item => (
            <span key={item.id} className={`comms-queue-chip status-${item.status}`}>
              <span className="comms-queue-chip-date">{item.date.slice(5)}</span>
              {item.status === 'queued' && <span className="comms-queue-dim">·</span>}
              {item.status === 'generating' && <Loader2 size={9} className="spin" />}
              {item.status === 'done' && <CheckCircle2 size={9} className="comms-queue-done-icon" />}
              {item.status === 'error' && <span title={item.error}><AlertTriangle size={9} className="comms-queue-err-icon" /></span>}
            </span>
          ))}
          {hasFinished && (
            <button type="button" className="comms-queue-clear-btn" onClick={onClearFinished} title="limpar finalizados">
              limpar
            </button>
          )}
        </div>
        {generatingItem?.progressMsg && (
          <span className="comms-digestbar-queue-progress">{generatingItem.progressMsg}</span>
        )}
      </div>

      {/* Right: generate button */}
      <button
        type="button"
        className="comms-digestbar-btn"
        disabled={disabled}
        onClick={onGenerate}
        title={tooltip}
      >
        {busy ? <Loader2 size={13} className="spin" /> : <Brain size={13} />}
        {busy ? 'gerando…' : `gerar digest (${selected})`}
      </button>
    </div>
  );
};
