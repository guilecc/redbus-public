import { v4 as uuidv4 } from 'uuid';
import { logActivity } from './activityLogger';
import { storeTodoEventInMempalace } from './aaakService';

export interface Todo {
  id: string;
  content: string;
  target_date: string | null;
  status: 'pending' | 'completed';
  archived: number;
  created_at: string;
}

export interface CreateTodoPayload {
  content: string;
  target_date?: string | null;
}

/**
 * Create a new To-Do item.
 */
export function createTodo(db: any, payload: CreateTodoPayload): Todo {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO Todos (id, content, target_date, status, archived, created_at)
    VALUES (?, ?, ?, 'pending', 0, ?)
  `).run(id, payload.content, payload.target_date || null, now);

  logActivity('todos', `To-Do criado: "${payload.content.slice(0, 60)}"`, { todoId: id });

  // MemPalace integration
  storeTodoEventInMempalace(db, { type: 'created', content: payload.content, todoId: id, target_date: payload.target_date });

  return {
    id,
    content: payload.content,
    target_date: payload.target_date || null,
    status: 'pending',
    archived: 0,
    created_at: now,
  };
}

/**
 * List To-Dos. By default returns non-archived items.
 */
export function listTodos(db: any, includeArchived = false): Todo[] {
  if (includeArchived) {
    return db.prepare('SELECT * FROM Todos ORDER BY created_at DESC').all();
  }
  return db.prepare('SELECT * FROM Todos WHERE archived = 0 ORDER BY created_at DESC').all();
}

/**
 * Get pending todos with upcoming or overdue target_date.
 */
export function getPendingTodosWithDeadline(db: any, withinMs: number = 2 * 60 * 60 * 1000): Todo[] {
  const now = new Date();
  const threshold = new Date(now.getTime() + withinMs).toISOString();
  return db.prepare(`
    SELECT * FROM Todos
    WHERE status = 'pending' AND archived = 0 AND target_date IS NOT NULL AND target_date <= ?
    ORDER BY target_date ASC
  `).all(threshold);
}

/**
 * Mark a To-Do as completed.
 */
export function completeTodo(db: any, todoId: string): boolean {
  const result = db.prepare("UPDATE Todos SET status = 'completed' WHERE id = ?").run(todoId);
  if (result.changes > 0) {
    const todo = db.prepare('SELECT content FROM Todos WHERE id = ?').get(todoId);
    logActivity('todos', `To-Do concluído: "${(todo?.content || '').slice(0, 60)}"`, { todoId });
    // MemPalace integration
    storeTodoEventInMempalace(db, { type: 'completed', content: todo?.content || '', todoId });
  }
  return result.changes > 0;
}

/**
 * Archive a To-Do (soft delete).
 */
export function archiveTodo(db: any, todoId: string): boolean {
  const result = db.prepare('UPDATE Todos SET archived = 1 WHERE id = ?').run(todoId);
  return result.changes > 0;
}

/**
 * Unarchive a To-Do.
 */
export function unarchiveTodo(db: any, todoId: string): boolean {
  const result = db.prepare('UPDATE Todos SET archived = 0 WHERE id = ?').run(todoId);
  return result.changes > 0;
}

/**
 * Delete a To-Do permanently.
 */
export function deleteTodo(db: any, todoId: string): boolean {
  const result = db.prepare('DELETE FROM Todos WHERE id = ?').run(todoId);
  return result.changes > 0;
}

/**
 * Get a single To-Do by ID.
 */
export function getTodo(db: any, todoId: string): Todo | null {
  return db.prepare('SELECT * FROM Todos WHERE id = ?').get(todoId) || null;
}

/**
 * Find a pending todo by content (fuzzy match for orchestrator check_todo).
 */
export function findTodoByContent(db: any, query: string): Todo | null {
  return db.prepare(
    "SELECT * FROM Todos WHERE status = 'pending' AND archived = 0 AND content LIKE ? ORDER BY created_at DESC LIMIT 1"
  ).get(`%${query}%`) || null;
}

