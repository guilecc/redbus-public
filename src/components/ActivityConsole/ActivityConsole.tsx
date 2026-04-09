import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../../i18n/index.js';

type ActivityCategory = 'sensors' | 'meetings' | 'routines' | 'proactivity' | 'orchestrator';

interface ActivityLogEntry {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  message: string;
  metadata?: any;
}

interface ActivityConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  sensors: '#00d4ff',
  meetings: '#ff6b35',
  routines: '#4ecdc4',
  proactivity: '#ffe66d',
  orchestrator: '#a8dadc',
};

const ALL_CATEGORIES: ActivityCategory[] = ['sensors', 'meetings', 'routines', 'proactivity', 'orchestrator'];
const MAX_DISPLAY = 100;

export const ActivityConsole: React.FC<ActivityConsoleProps> = ({ isOpen, onClose }) => {
  const { t, lang } = useTranslation();
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [filters, setFilters] = useState<Record<ActivityCategory, boolean>>({
    sensors: true, meetings: true, routines: true, proactivity: true, orchestrator: true,
  });
  const listRef = useRef<HTMLDivElement>(null);

  const CATEGORY_LABELS: Record<ActivityCategory, string> = {
    sensors: t.titlebar.nav.chat === 'Chat Terminal' ? 'Sensors' : 'Sensores', // Fallback logic if needed, but better to use t values
    meetings: t.titlebar.nav.meetings,
    routines: t.titlebar.nav.routines,
    proactivity: t.settings.tabs.proactivity,
    orchestrator: 'Orchestrator',
  };

  // Load initial logs & subscribe to real-time updates
  useEffect(() => {
    if (!isOpen) return;

    const api = window.redbusAPI;
    if (!api) return;

    // Fetch existing logs
    api.getRecentActivityLogs(MAX_DISPLAY).then((res: any) => {
      if (res?.status === 'OK' && res.data) {
        setLogs(res.data.slice(-MAX_DISPLAY));
      }
    });

    // Subscribe to real-time log entries
    api.onActivityLogEntry((entry: ActivityLogEntry) => {
      setLogs(prev => {
        const next = [...prev, entry];
        return next.length > MAX_DISPLAY ? next.slice(next.length - MAX_DISPLAY) : next;
      });
    });
  }, [isOpen]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [logs]);

  const toggleFilter = (cat: ActivityCategory) => {
    setFilters(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const filteredLogs = logs.filter(log => filters[log.category]);

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(lang === 'pt-BR' ? 'pt-BR' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="activity-console" data-testid="activity-console">
      {/* Header */}
      <div className="activity-console-header">
        <span className="activity-console-title">{t.activityConsole.title}</span>
        <button
          className="activity-console-close"
          data-testid="activity-console-close"
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </div>

      {/* Filters */}
      <div className="activity-console-filters">
        {ALL_CATEGORIES.map(cat => (
          <label
            key={cat}
            className="activity-filter-label"
            style={{ color: filters[cat] ? CATEGORY_COLORS[cat] : '#555' }}
          >
            <input
              type="checkbox"
              checked={filters[cat]}
              onChange={() => toggleFilter(cat)}
              data-testid={`filter-${cat}`}
              className="activity-filter-checkbox"
            />
            {CATEGORY_LABELS[cat]}
          </label>
        ))}
      </div>

      {/* Log list */}
      <div className="activity-console-list" ref={listRef}>
        {filteredLogs.map(log => (
          <div key={log.id} className="activity-log-entry" data-testid="activity-log-item">
            <span className="activity-log-time">{formatTime(log.timestamp)}</span>
            <span
              className="activity-log-category"
              style={{ color: CATEGORY_COLORS[log.category] }}
            >
              [{CATEGORY_LABELS[log.category]}]
            </span>
            <span className="activity-log-message">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};


