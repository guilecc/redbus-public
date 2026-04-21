import React from 'react';
import { Mail, Hash, FileText, type LucideIcon } from 'lucide-react';

export type CommsTabId = 'outlook' | 'teams' | 'digest';

interface Props {
  active: CommsTabId;
  onChange: (t: CommsTabId) => void;
  counts: { outlook: number; teams: number };
  hasDigest: boolean;
}

const TABS: { id: CommsTabId; label: string; Icon: LucideIcon }[] = [
  { id: 'outlook', label: 'Email', Icon: Mail },
  { id: 'teams', label: 'Teams', Icon: Hash },
  { id: 'digest', label: 'Digest', Icon: FileText },
];

export const CommsTabs: React.FC<Props> = ({ active, onChange, counts, hasDigest }) => (
  <div className="comms-tabs" role="tablist">
    {TABS.map(({ id, label, Icon }) => {
      const isActive = active === id;
      const badge = id === 'outlook' ? counts.outlook : id === 'teams' ? counts.teams : undefined;
      return (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={isActive}
          className={`comms-tab${isActive ? ' active' : ''}`}
          onClick={() => onChange(id)}
        >
          <Icon size={13} />
          <span>{label}</span>
          {typeof badge === 'number' && <span className="comms-tab-badge">{badge}</span>}
          {id === 'digest' && hasDigest && <span className="comms-tab-dot" title="digest disponível" />}
        </button>
      );
    })}
  </div>
);

