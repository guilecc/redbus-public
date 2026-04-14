import React, { useState, useEffect, useCallback } from 'react';
import { ListTodo, Plus, Archive, ArchiveRestore, Trash2, Clock } from 'lucide-react';

interface TodoItem {
  id: string;
  content: string;
  target_date: string | null;
  status: 'pending' | 'completed';
  archived: number;
  created_at: string;
}

export const TodoManager: React.FC = () => {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [newContent, setNewContent] = useState('');
  const [newDate, setNewDate] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchTodos = useCallback(async () => {
    try {
      const res = await window.redbusAPI.listTodos(showArchived);
      if (res.status === 'OK' && res.data) setTodos(res.data);
    } catch { }
    setLoading(false);
  }, [showArchived]);

  useEffect(() => { fetchTodos(); }, [fetchTodos]);

  const handleCreate = async () => {
    const content = newContent.trim();
    if (!content) return;
    try {
      const res = await window.redbusAPI.createTodo({
        content,
        target_date: newDate ? new Date(newDate).toISOString() : null,
      });
      if (res.status === 'OK' && res.data) {
        const newTodo = res.data;
        setTodos(prev => [newTodo, ...prev]);
        setNewContent('');
        setNewDate('');
      }
    } catch { }
  };

  const handleToggle = async (todo: TodoItem) => {
    if (todo.status === 'completed') return;
    try {
      const res = await window.redbusAPI.completeTodo(todo.id);
      if (res.status === 'OK') {
        setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, status: 'completed' } : t));
      }
    } catch { }
  };

  const handleArchive = async (todoId: string) => {
    try {
      const res = await window.redbusAPI.archiveTodo(todoId);
      if (res.status === 'OK') {
        if (!showArchived) setTodos(prev => prev.filter(t => t.id !== todoId));
        else setTodos(prev => prev.map(t => t.id === todoId ? { ...t, archived: 1 } : t));
      }
    } catch { }
  };

  const handleUnarchive = async (todoId: string) => {
    try {
      const res = await window.redbusAPI.unarchiveTodo(todoId);
      if (res.status === 'OK') {
        setTodos(prev => prev.map(t => t.id === todoId ? { ...t, archived: 0 } : t));
      }
    } catch { }
  };

  const handleDelete = async (todoId: string) => {
    try {
      const res = await window.redbusAPI.deleteTodo(todoId);
      if (res.status === 'OK') setTodos(prev => prev.filter(t => t.id !== todoId));
    } catch { }
  };

  const isOverdue = (todo: TodoItem) => {
    if (!todo.target_date || todo.status === 'completed') return false;
    return new Date(todo.target_date) < new Date();
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const pending = todos.filter(t => t.status === 'pending' && !t.archived);
  const completed = todos.filter(t => t.status === 'completed' && !t.archived);
  const archived = todos.filter(t => t.archived);

  return (
    <div className="todo-manager" data-testid="todo-manager">
      <header className="todo-header">
        <h2><ListTodo size={18} style={{ display: 'inline', verticalAlign: 'sub', marginRight: 6 }} /> to-dos</h2>
        <button
          className={`todo-filter-btn${showArchived ? ' active' : ''}`}
          onClick={() => setShowArchived(prev => !prev)}
          title={showArchived ? 'Ocultar arquivados' : 'Mostrar arquivados'}
        >
          <Archive size={13} /> {showArchived ? 'ocultar arquivados' : 'ver arquivados'}
        </button>
      </header>

      {/* Input */}
      <div className="todo-input-row">
        <input
          className="todo-input"
          type="text"
          placeholder="nova tarefa..."
          value={newContent}
          onChange={e => setNewContent(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          data-testid="todo-input"
        />
        <input
          className="todo-date-input"
          type="datetime-local"
          value={newDate}
          onChange={e => setNewDate(e.target.value)}
          title="Prazo (opcional)"
        />
        <button className="todo-add-btn" onClick={handleCreate} disabled={!newContent.trim()} data-testid="todo-add-btn">
          <Plus size={14} />
        </button>
      </div>

      {loading ? (
        <p className="todo-empty">carregando...</p>
      ) : (
        <div className="todo-list">
          {pending.length === 0 && completed.length === 0 && !showArchived && (
            <p className="todo-empty">nenhuma tarefa. adicione acima ↑</p>
          )}

          {pending.map(todo => (
            <div key={todo.id} className={`todo-item${isOverdue(todo) ? ' overdue' : ''}`} data-testid="todo-item">
              <input type="checkbox" className="todo-checkbox" checked={false} onChange={() => handleToggle(todo)} />
              <span className="todo-content">{todo.content}</span>
              {todo.target_date && (
                <span className={`todo-date${isOverdue(todo) ? ' overdue' : ''}`} title={fmtDate(todo.target_date)}>
                  <Clock size={10} /> {fmtDate(todo.target_date)}
                </span>
              )}
              <div className="todo-actions">
                <button onClick={() => handleArchive(todo.id)} title="Arquivar"><Archive size={12} /></button>
                <button onClick={() => handleDelete(todo.id)} title="Excluir"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}

          {completed.length > 0 && (
            <>
              <div className="todo-section-divider">concluídos ({completed.length})</div>
              {completed.map(todo => (
                <div key={todo.id} className="todo-item completed" data-testid="todo-item-completed">
                  <input type="checkbox" className="todo-checkbox" checked disabled />
                  <span className="todo-content completed">{todo.content}</span>
                  <div className="todo-actions">
                    <button onClick={() => handleArchive(todo.id)} title="Arquivar"><Archive size={12} /></button>
                    <button onClick={() => handleDelete(todo.id)} title="Excluir"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </>
          )}

          {showArchived && archived.length > 0 && (
            <>
              <div className="todo-section-divider">arquivados ({archived.length})</div>
              {archived.map(todo => (
                <div key={todo.id} className="todo-item archived" data-testid="todo-item-archived">
                  <input type="checkbox" className="todo-checkbox" checked={todo.status === 'completed'} disabled />
                  <span className="todo-content archived">{todo.content}</span>
                  <div className="todo-actions">
                    <button onClick={() => handleUnarchive(todo.id)} title="Restaurar"><ArchiveRestore size={12} /></button>
                    <button onClick={() => handleDelete(todo.id)} title="Excluir"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

