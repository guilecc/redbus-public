import React, { useState, useEffect, useCallback } from 'react';
import { Timer, RefreshCw } from 'lucide-react';
import { RoutineCard } from './RoutineCard';

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

export const RoutineManager: React.FC = () => {
  const [routines, setRoutines] = useState<RoutineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchRoutines = useCallback(async () => {
    try {
      const res = await window.redbusAPI.listRoutines();
      if (res.status === 'OK' && res.data) setRoutines(res.data);
    } catch (e) {
      console.error('[RoutineManager] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoutines();
    const interval = setInterval(fetchRoutines, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchRoutines]);

  const handlePause = async (id: string) => {
    await window.redbusAPI.pauseRoutine(id);
    fetchRoutines();
  };

  const handleResume = async (id: string) => {
    await window.redbusAPI.resumeRoutine(id);
    fetchRoutines();
  };

  const handleDelete = async (id: string) => {
    await window.redbusAPI.deleteRoutine(id);
    fetchRoutines();
  };

  const handleRunNow = async (id: string) => {
    await window.redbusAPI.runRoutineNow(id);
    setTimeout(fetchRoutines, 2000); // wait a bit for execution to start
  };

  const handleUpdateCron = async (id: string, cron: string) => {
    const res = await window.redbusAPI.updateRoutineCron(id, cron);
    if (res.status === 'OK') fetchRoutines();
    return res;
  };

  const activeCount = routines.filter(r => r.enabled).length;
  const pausedCount = routines.filter(r => !r.enabled).length;
  const selectedRoutine = routines.find(r => r.id === selectedId) || null;

  return (
    <div className="view-layout">
      {/* Sidebar */}
      <aside className="view-sidebar">
        <div className="view-sidebar-header">
          <h2><Timer size={16} style={{ display: 'inline', verticalAlign: 'sub', marginRight: '6px' }} /> rotinas</h2>
          <button className="titlebar-btn" onClick={fetchRoutines} title="Atualizar">
            <RefreshCw size={11} />
          </button>
        </div>
        
        <div className="view-sidebar-list" data-testid="routine-list">
          {loading && (
            <p className="view-empty" style={{ textAlign: 'center', marginTop: '20px' }}>carregando...</p>
          )}

          {!loading && routines.length === 0 && (
            <p className="view-empty" style={{ textAlign: 'center', marginTop: '20px', lineHeight: 1.4 }}>
              nenhuma rotina configurada.<br />
              peça ao maestro para criar uma tarefa recorrente.
            </p>
          )}

          {routines.map(r => (
            <div
              key={r.id}
              className={`view-sidebar-item${selectedId === r.id ? ' active' : ''}`}
              onClick={() => setSelectedId(r.id)}
            >
              <div className="view-sidebar-item-title" style={{ color: r.enabled ? 'var(--text-primary)' : 'var(--text-ghost)' }}>
                {r.skill_name || (r.goal.length > 30 ? r.goal.slice(0, 30) + '...' : r.goal)}
              </div>
              <div className="view-sidebar-item-meta" style={{ marginTop: '2px', color: r.enabled ? 'var(--text-dim)' : 'var(--text-ghost)' }}>
                {r.enabled ? 'ativa' : 'pausada'} · {r.cron_expression} {r.consecutive_errors > 0 ? '· erro!' : ''}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Detail Area */}
      <main className="view-detail">
        {!selectedRoutine ? (
          <div className="view-detail-empty">
            <Timer size={32} strokeWidth={1} />
            <p>selecione uma rotina para visualizar os detalhes</p>
            <p style={{ marginTop: '12px', color: 'var(--text-dim)' }}>
              {activeCount} ativa{activeCount !== 1 ? 's' : ''} · {pausedCount} pausada{pausedCount !== 1 ? 's' : ''}
            </p>
          </div>
        ) : (
          <div className="view-detail-content">
            <header className="view-detail-header">
              <div className="view-detail-title-row">
                <h1>Detalhamento da Rotina</h1>
              </div>
            </header>
            <div className="view-body">
              <div style={{ padding: '0 4px' }}>
                <RoutineCard
                  routine={selectedRoutine}
                  onPause={handlePause}
                  onResume={handleResume}
                  onDelete={(id) => { handleDelete(id); setSelectedId(null); }}
                  onRunNow={handleRunNow}
                  onUpdateCron={handleUpdateCron}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

