import React from 'react';
import { Mail, Hash, AtSign, AlertTriangle } from 'lucide-react';
import type { CommunicationItem } from '../../types/ipc';

interface Props {
  item: CommunicationItem;
  selected: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  style?: React.CSSProperties;
}

function fmtTs(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } catch { return ''; }
}

function firstLine(text: string, max = 80): string {
  const t = (text || '').split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0) || '';
  return t.length > max ? t.slice(0, max) + '…' : t;
}

export const MessageItem: React.FC<Props> = ({ item, selected, onToggle, onOpen, style }) => {
  const isOutlook = item.source === 'outlook';
  const icon = isOutlook ? <Mail size={13} /> : <Hash size={13} />;
  const preview = item.subject || firstLine(item.plainText);
  const cls = [
    'comms-msg-item',
    selected ? 'selected' : '',
    item.isUnread ? 'unread' : '',
    item.importance === 'high' ? 'high' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} style={style} onDoubleClick={onOpen} role="listitem">
      <label className="comms-msg-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label="selecionar" />
      </label>
      <span className="comms-msg-icon" style={{ color: isOutlook ? 'var(--accent)' : '#6264a7' }}>{icon}</span>
      <div className="comms-msg-body">
        <div className="comms-msg-row1">
          <span className="comms-msg-sender" title={item.senderEmail || item.sender}>{item.sender || '—'}</span>
          <span className="comms-msg-dot">·</span>
          <span className="comms-msg-time">{fmtTs(item.timestamp)}</span>
          {item.mentionsMe && <span className="comms-msg-badge mention" title="menção direta"><AtSign size={10} /></span>}
          {item.importance === 'high' && <span className="comms-msg-badge high" title="importance=high"><AlertTriangle size={10} /></span>}
          {item.isUnread && <span className="comms-msg-badge unread">NÃO LIDO</span>}
        </div>
        <div className="comms-msg-row2" title={preview}>{preview || '(sem conteúdo)'}</div>
      </div>
    </div>
  );
};

