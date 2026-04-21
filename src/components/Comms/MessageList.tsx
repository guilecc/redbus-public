import React, { useRef, useEffect, useMemo } from 'react';
import { List, type RowComponentProps } from 'react-window';
import type { CommunicationItem } from '../../types/ipc';
import { MessageItem } from './MessageItem';

interface Props {
  items: CommunicationItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onOpen?: (item: CommunicationItem) => void;
}

const ROW_HEIGHT = 52;

interface RowProps {
  items: CommunicationItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onOpen?: (item: CommunicationItem) => void;
}

function Row({ index, style, items, selectedIds, onToggle, onOpen }: RowComponentProps<RowProps>): React.ReactElement | null {
  const it = items[index];
  if (!it) return null;
  return (
    <MessageItem
      item={it}
      selected={selectedIds.has(it.id)}
      onToggle={() => onToggle(it.id)}
      onOpen={onOpen ? () => onOpen(it) : undefined}
      style={style}
    />
  );
}

export const MessageList: React.FC<Props> = ({ items, selectedIds, onToggle, onToggleAll, onOpen }) => {
  // Spec 11 §6.3: selected ∩ visíveis
  const visibleSelected = items.reduce((n, i) => n + (selectedIds.has(i.id) ? 1 : 0), 0);
  const allVisibleSelected = items.length > 0 && visibleSelected === items.length;
  const someSelected = visibleSelected > 0 && !allVisibleSelected;

  const headerRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const rowProps = useMemo<RowProps>(() => ({ items, selectedIds, onToggle, onOpen }), [items, selectedIds, onToggle, onOpen]);

  return (
    <div className="comms-list-wrap">
      <div className="comms-list-header">
        <label className="comms-msg-check">
          <input
            ref={headerRef}
            type="checkbox"
            checked={allVisibleSelected}
            onChange={(e) => onToggleAll(e.target.checked)}
            aria-label="selecionar todos visíveis"
          />
        </label>
        <span className="comms-list-count">{visibleSelected} de {items.length} selecionados</span>
      </div>
      <div className="comms-list-body">
        {items.length === 0 && (
          <div className="comms-list-empty">nenhuma comunicação após filtros</div>
        )}
        {items.length > 0 && (
          <List
            rowComponent={Row}
            rowCount={items.length}
            rowHeight={ROW_HEIGHT}
            rowProps={rowProps}
            overscanCount={6}
            style={{ height: '100%', width: '100%' }}
          />
        )}
      </div>
    </div>
  );
};

