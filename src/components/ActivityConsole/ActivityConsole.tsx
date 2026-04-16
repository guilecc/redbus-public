import { useEffect, useRef, useState, useCallback } from 'react';
import { X, WrapText, AlignLeft } from 'lucide-react';
import { useTranslation } from '../../i18n/index.js';

type ActivityCategory = 'sensors' | 'meetings' | 'routines' | 'proactivity' | 'orchestrator' | 'inbox' | 'todos' | 'console';

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
  inbox: '#c084fc',
  todos: '#86efac',
  console: '#94a3b8',
};

const ALL_CATEGORIES: ActivityCategory[] = ['sensors', 'meetings', 'routines', 'proactivity', 'orchestrator', 'inbox', 'todos', 'console'];
const MAX_DISPLAY = 200;

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 700;
const DEFAULT_HEIGHT = 300;
const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 300;
const MAX_WIDTH = 800;

export const ActivityConsole: React.FC<ActivityConsoleProps> = ({ isOpen, onClose }) => {
  const { t, lang } = useTranslation();
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [filters, setFilters] = useState<Record<ActivityCategory, boolean>>({
    sensors: true, meetings: true, routines: true, proactivity: true,
    orchestrator: true, inbox: true, todos: true, console: true,
  });
  const [wordWrap, setWordWrap] = useState(true);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);

  const listRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef<{ type: 'v' | 'h' | 'both'; startY: number; startX: number; startH: number; startW: number } | null>(null);

  const CATEGORY_LABELS: Record<ActivityCategory, string> = {
    sensors: t.titlebar.nav.chat === 'Chat Terminal' ? 'Sensors' : 'Sensores',
    meetings: t.titlebar.nav.meetings,
    routines: t.titlebar.nav.routines,
    proactivity: t.settings.tabs.proactivity,
    orchestrator: 'Orchestrator',
    inbox: t.titlebar.nav.inbox,
    todos: t.titlebar.nav.todos,
    console: 'Console',
  };

  // Load initial logs & subscribe to real-time updates
  useEffect(() => {
    if (!isOpen) return;

    const api = window.redbusAPI;
    if (!api) return;

    api.getRecentActivityLogs(MAX_DISPLAY).then((res: any) => {
      if (res?.status === 'OK' && res.data) {
        setLogs(res.data.slice(-MAX_DISPLAY));
      }
    });

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

  // ── Resize logic ──────────────────────────────────────────────
  const onMouseMove = useCallback((e: MouseEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    if (r.type === 'v' || r.type === 'both') {
      const dy = r.startY - e.clientY; // dragging up = taller
      const newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, r.startH + dy));
      setPanelHeight(newH);
    }
    if (r.type === 'h' || r.type === 'both') {
      const dx = r.startX - e.clientX; // panel anchored right, dragging left = wider
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, r.startW + dx));
      setPanelWidth(newW);
    }
  }, []);

  const onMouseUp = useCallback(() => {
    resizingRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const startResize = (e: React.MouseEvent, type: 'v' | 'h' | 'both') => {
    e.preventDefault();
    resizingRef.current = { type, startY: e.clientY, startX: e.clientX, startH: panelHeight, startW: panelWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = type === 'v' ? 'ns-resize' : type === 'h' ? 'ew-resize' : 'nwse-resize';
  };

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
    <div
      className="activity-console"
      data-testid="activity-console"
      style={{ height: panelHeight, width: panelWidth }}
    >
      {/* Top resize handle (vertical) */}
      <div
        className="activity-resize-handle activity-resize-handle--top"
        onMouseDown={e => startResize(e, 'v')}
        title="Drag to resize"
      />

      {/* Left resize handle (horizontal) */}
      <div
        className="activity-resize-handle activity-resize-handle--left"
        onMouseDown={e => startResize(e, 'h')}
        title="Drag to resize"
      />

      {/* Top-left corner resize (both) */}
      <div
        className="activity-resize-handle activity-resize-handle--corner"
        onMouseDown={e => startResize(e, 'both')}
        title="Drag to resize"
      />

      {/* Header */}
      <div className="activity-console-header">
        <span className="activity-console-title">{t.activityConsole.title}</span>
        <div className="activity-console-header-actions">
          <button
            className={`activity-console-action-btn${wordWrap ? ' active' : ''}`}
            onClick={() => setWordWrap(w => !w)}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            data-testid="activity-wordwrap-toggle"
          >
            {wordWrap ? <WrapText size={11} /> : <AlignLeft size={11} />}
          </button>
          <button
            className="activity-console-close"
            data-testid="activity-console-close"
            onClick={onClose}
          >
            <X size={12} />
          </button>
        </div>
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
        {filteredLogs.length === 0 && (
          <div className="activity-log-empty">{t.activityConsole.empty}</div>
        )}
        {filteredLogs.map(log => (
          <div
            key={log.id}
            className={`activity-log-entry${wordWrap ? ' wrap' : ''}`}
            data-testid="activity-log-item"
          >
            <span className="activity-log-time">{formatTime(log.timestamp)}</span>
            <span
              className="activity-log-category"
              style={{ color: CATEGORY_COLORS[log.category] }}
            >
              [{CATEGORY_LABELS[log.category]}]
            </span>
            <span className={`activity-log-message${wordWrap ? ' wrap' : ''}`}>{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
