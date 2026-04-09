import React, { useState } from 'react';
import { Pause, Play, Trash2, Zap, Edit3, Check, X, AlertTriangle } from 'lucide-react';
import { RoutinePipeline } from './RoutinePipeline';

interface RoutineEntry {
  id: string;
  goal: string;
  cron_expression: string;
  enabled: boolean;
  status: string;
  next_run_at: string | null;
  last_run: string | null;
  last_error: string | null;
  consecutive_errors: number;
  last_duration_ms: number | null;
  timezone: string;
  skill_name: string | null;
  python_script: boolean;
  steps: Array<{ url: string; instruction: string }>;
}

interface RoutineCardProps {
  routine: RoutineEntry;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onRunNow: (id: string) => void;
  onUpdateCron: (id: string, cron: string) => Promise<any>;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' ' + time;
  } catch { return iso; }
}

function formatDuration(ms: number | null): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const RoutineCard: React.FC<RoutineCardProps> = ({
  routine, onPause, onResume, onDelete, onRunNow, onUpdateCron,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingCron, setEditingCron] = useState(false);
  const [cronDraft, setCronDraft] = useState(routine.cron_expression);
  const [running, setRunning] = useState(false);

  const hasError = routine.consecutive_errors > 0;
  const borderColor = !routine.enabled ? 'var(--text-ghost)' : hasError ? '#ff4040' : 'var(--accent)';

  const handleRunNow = async () => {
    setRunning(true);
    await onRunNow(routine.id);
    setTimeout(() => setRunning(false), 3000);
  };

  const handleSaveCron = async () => {
    const res = await onUpdateCron(routine.id, cronDraft);
    if (res?.status === 'OK') setEditingCron(false);
  };

  return (
    <div
      data-testid={`routine-card-${routine.id}`}
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: '4px',
        padding: '14px 16px',
        background: 'var(--bg-surface)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {!routine.enabled && <Pause size={10} style={{ color: 'var(--text-ghost)' }} />}
            {hasError && <AlertTriangle size={10} style={{ color: '#ff4040' }} />}
            <span style={{ fontSize: '12px', fontWeight: 600, color: routine.enabled ? 'var(--accent)' : 'var(--text-ghost)', fontFamily: 'monospace' }}>
              {routine.skill_name || routine.goal.slice(0, 50)}
            </span>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '3px', lineHeight: 1.4 }}>
            {routine.goal.length > 100 ? routine.goal.slice(0, 100) + '…' : routine.goal}
          </div>
        </div>

        {/* Cron expression */}
        <div style={{ textAlign: 'right', marginLeft: '12px', flexShrink: 0 }}>
          {editingCron ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                value={cronDraft}
                onChange={e => setCronDraft(e.target.value)}
                style={{ width: '120px', fontSize: '10px', fontFamily: 'monospace', padding: '2px 6px' }}
                data-testid="cron-edit-input"
              />
              <button className="save-btn" onClick={handleSaveCron} style={{ padding: '2px 4px' }}><Check size={10} /></button>
              <button className="save-btn" onClick={() => { setEditingCron(false); setCronDraft(routine.cron_expression); }} style={{ padding: '2px 4px' }}><X size={10} /></button>
            </div>
          ) : (
            <span style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--text-dim)', cursor: 'pointer' }} onClick={() => setEditingCron(true)} title="Clique para editar">
              {routine.cron_expression}
            </span>
          )}
          <div style={{ fontSize: '9px', color: 'var(--text-ghost)', marginTop: '2px' }}>
            próx: {formatTime(routine.next_run_at)}
          </div>
        </div>
      </div>

      {/* Status line */}
      <div style={{ fontSize: '9px', color: hasError ? '#ff4040' : 'var(--text-ghost)', marginTop: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <span>último: {formatTime(routine.last_run)}</span>
        {routine.last_duration_ms != null && <span>· {formatDuration(routine.last_duration_ms)}</span>}
        {hasError && <span>· {routine.consecutive_errors} erro{routine.consecutive_errors > 1 ? 's' : ''} consecutivo{routine.consecutive_errors > 1 ? 's' : ''}</span>}
        {routine.last_error && <span title={routine.last_error}>· "{routine.last_error.slice(0, 60)}"</span>}
        {!routine.enabled && <span style={{ color: 'var(--text-ghost)' }}>· pausada</span>}
      </div>

      {/* Pipeline visualization */}
      <RoutinePipeline skillName={routine.skill_name} pythonScript={routine.python_script} steps={routine.steps} />

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
        {routine.enabled ? (
          <button className="save-btn" onClick={() => onPause(routine.id)} title="Pausar">
            <Pause size={10} /> pausar
          </button>
        ) : (
          <button className="save-btn" onClick={() => onResume(routine.id)} title="Retomar">
            <Play size={10} /> retomar
          </button>
        )}
        <button className="save-btn" onClick={handleRunNow} disabled={running} title="Executar agora">
          <Zap size={10} /> {running ? 'executando...' : 'executar agora'}
        </button>
        <button className="save-btn" onClick={() => setEditingCron(true)} title="Editar cron">
          <Edit3 size={10} /> cron
        </button>
        <div style={{ flex: 1 }} />
        {!confirmDelete ? (
          <button className="save-btn" style={{ color: '#ff4040', borderColor: '#ff4040' }} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={10} />
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '9px', color: '#ff4040' }}>deletar?</span>
            <button className="save-btn" style={{ color: '#ff4040', borderColor: '#ff4040' }} onClick={() => onDelete(routine.id)}>sim</button>
            <button className="save-btn" onClick={() => setConfirmDelete(false)}>não</button>
          </div>
        )}
      </div>
    </div>
  );
};

