import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Mail, Hash, AtSign, AlertTriangle, Ban } from 'lucide-react';
import type { CommunicationItem } from '../../types/ipc';
import { groupMessages, type MessageGroup } from './groupLogic';

interface Props {
  items: CommunicationItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onToggleGroup: (group: MessageGroup, checked: boolean) => void;
  onBlacklistGroup: (token: string) => void;
  onOpen?: (item: CommunicationItem) => void;
  source: 'outlook' | 'teams';
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

function firstLine(text: string, max = 120): string {
  const t = (text || '').split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0) || '';
  return t.length > max ? t.slice(0, max) + '…' : t;
}

const GroupRow: React.FC<{
  group: MessageGroup;
  expanded: boolean;
  onToggleExpand: () => void;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleGroup: (g: MessageGroup, checked: boolean) => void;
  onBlacklistGroup: (token: string) => void;
  onOpen?: (item: CommunicationItem) => void;
  source: 'outlook' | 'teams';
}> = ({ group, expanded, onToggleExpand, selectedIds, onToggle, onToggleGroup, onBlacklistGroup, onOpen, source }) => {
  const selCount = group.items.reduce((n, i) => n + (selectedIds.has(i.id) ? 1 : 0), 0);
  const allSel = selCount === group.items.length && selCount > 0;
  const someSel = selCount > 0 && !allSel;
  const ref = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = someSel; }, [someSel]);
  const Icon = source === 'outlook' ? Mail : Hash;
  const iconColor = source === 'outlook' ? 'var(--accent)' : '#6264a7';

  return (
    <div className={`comms-group ${expanded ? 'expanded' : ''} ${group.hasUnread ? 'unread' : ''}`}>
      <div className="comms-group-header">
        <label className="comms-msg-check" onClick={(e) => e.stopPropagation()}>
          <input ref={ref} type="checkbox" checked={allSel} onChange={(e) => onToggleGroup(group, e.target.checked)} aria-label="selecionar grupo" />
        </label>
        <button type="button" className="comms-group-toggle" onClick={onToggleExpand} aria-expanded={expanded}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Icon size={13} style={{ color: iconColor }} />
          <span className="comms-group-label" title={group.label}>{group.label}</span>
          <span className="comms-group-count">{group.items.length}</span>
          {group.hasMention && <span className="comms-msg-badge mention" title="menção"><AtSign size={10} /></span>}
          {group.hasUnread && <span className="comms-msg-badge unread">NÃO LIDO</span>}
          <span className="comms-group-time">{fmtTs(group.latest)}</span>
        </button>
        <button
          type="button"
          className="comms-group-blacklist"
          onClick={(e) => { e.stopPropagation(); if (group.blacklistToken) onBlacklistGroup(group.blacklistToken); }}
          title={group.blacklistToken ? `adicionar à blacklist: ${group.blacklistToken}` : 'sem token para blacklist'}
          disabled={!group.blacklistToken}
          aria-label="adicionar à blacklist"
        >
          <Ban size={11} />
        </button>
      </div>
      {expanded && (
        <div className="comms-group-items">
          {group.items.map(it => {
            const sel = selectedIds.has(it.id);
            const cls = ['comms-msg-item', sel ? 'selected' : '', it.isUnread ? 'unread' : '', it.importance === 'high' ? 'high' : ''].filter(Boolean).join(' ');
            return (
              <div key={it.id} className={cls} onDoubleClick={onOpen ? () => onOpen(it) : undefined}>
                <label className="comms-msg-check" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={sel} onChange={() => onToggle(it.id)} aria-label="selecionar" />
                </label>
                <div className="comms-msg-body">
                  <div className="comms-msg-row1">
                    <span className="comms-msg-sender" title={it.senderEmail || it.sender}>{it.sender || '—'}</span>
                    <span className="comms-msg-dot">·</span>
                    <span className="comms-msg-time">{fmtTs(it.timestamp)}</span>
                    {it.mentionsMe && <span className="comms-msg-badge mention" title="menção"><AtSign size={10} /></span>}
                    {it.importance === 'high' && <span className="comms-msg-badge high"><AlertTriangle size={10} /></span>}
                  </div>
                  <div className="comms-msg-row2" title={firstLine(it.plainText, 240)}>{firstLine(it.plainText) || '(sem conteúdo)'}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const GroupedMessageList: React.FC<Props> = ({ items, selectedIds, onToggle, onToggleAll, onToggleGroup, onBlacklistGroup, onOpen, source }) => {
  const groups = useMemo(() => groupMessages(items), [items]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const visibleSelected = items.reduce((n, i) => n + (selectedIds.has(i.id) ? 1 : 0), 0);
  const allSel = items.length > 0 && visibleSelected === items.length;
  const someSel = visibleSelected > 0 && !allSel;
  const headerRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => { if (headerRef.current) headerRef.current.indeterminate = someSel; }, [someSel]);

  const toggleExpand = (k: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="comms-list-wrap">
      <div className="comms-list-header">
        <label className="comms-msg-check">
          <input ref={headerRef} type="checkbox" checked={allSel} onChange={(e) => onToggleAll(e.target.checked)} aria-label="selecionar todos visíveis" />
        </label>
        <span className="comms-list-count">{visibleSelected} de {items.length} selecionados · {groups.length} grupos</span>
      </div>
      <div className="comms-list-body">
        {groups.length === 0 && <div className="comms-list-empty">nenhuma comunicação após filtros</div>}
        {groups.map(g => (
          <GroupRow
            key={g.key}
            group={g}
            expanded={expanded.has(g.key)}
            onToggleExpand={() => toggleExpand(g.key)}
            selectedIds={selectedIds}
            onToggle={onToggle}
            onToggleGroup={onToggleGroup}
            onBlacklistGroup={onBlacklistGroup}
            onOpen={onOpen}
            source={source}
          />
        ))}
      </div>
    </div>
  );
};

