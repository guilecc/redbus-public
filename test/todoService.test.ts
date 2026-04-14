import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
}));

import { initializeDatabase } from '../electron/database';
import {
  createTodo,
  listTodos,
  completeTodo,
  archiveTodo,
  unarchiveTodo,
  deleteTodo,
  getTodo,
  findTodoByContent,
  getPendingTodosWithDeadline,
} from '../electron/services/todoService';

describe('todoService - CRUD + MemPalace', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it('1. createTodo deve criar um to-do e retornar o objeto completo', () => {
    const todo = createTodo(db, { content: 'Enviar relatório' });
    expect(todo.id).toBeDefined();
    expect(todo.content).toBe('Enviar relatório');
    expect(todo.status).toBe('pending');
    expect(todo.archived).toBe(0);
    expect(todo.target_date).toBeNull();
  });

  it('2. createTodo com target_date deve armazenar a data', () => {
    const date = '2026-04-14T10:00:00.000Z';
    const todo = createTodo(db, { content: 'Reunião', target_date: date });
    expect(todo.target_date).toBe(date);
  });

  it('3. listTodos deve retornar apenas itens não arquivados por padrão', () => {
    createTodo(db, { content: 'Task A' });
    const b = createTodo(db, { content: 'Task B' });
    archiveTodo(db, b.id);

    const list = listTodos(db);
    expect(list.length).toBe(1);
    expect(list[0].content).toBe('Task A');
  });

  it('4. listTodos com includeArchived=true deve retornar todos', () => {
    createTodo(db, { content: 'Task A' });
    const b = createTodo(db, { content: 'Task B' });
    archiveTodo(db, b.id);

    const list = listTodos(db, true);
    expect(list.length).toBe(2);
  });

  it('5. completeTodo deve mudar o status para completed', () => {
    const todo = createTodo(db, { content: 'Finalizar feature' });
    const result = completeTodo(db, todo.id);
    expect(result).toBe(true);

    const updated = getTodo(db, todo.id);
    expect(updated?.status).toBe('completed');
  });

  it('6. completeTodo com id inexistente deve retornar false', () => {
    expect(completeTodo(db, 'non-existent-id')).toBe(false);
  });

  it('7. archiveTodo e unarchiveTodo devem funcionar', () => {
    const todo = createTodo(db, { content: 'Arquivo me' });
    expect(archiveTodo(db, todo.id)).toBe(true);
    expect(getTodo(db, todo.id)?.archived).toBe(1);

    expect(unarchiveTodo(db, todo.id)).toBe(true);
    expect(getTodo(db, todo.id)?.archived).toBe(0);
  });

  it('8. deleteTodo deve remover permanentemente', () => {
    const todo = createTodo(db, { content: 'Delete me' });
    expect(deleteTodo(db, todo.id)).toBe(true);
    expect(getTodo(db, todo.id)).toBeNull();
  });

  it('9. findTodoByContent deve encontrar por conteúdo parcial', () => {
    createTodo(db, { content: 'Enviar relatório para gerência' });
    createTodo(db, { content: 'Comprar café' });

    const found = findTodoByContent(db, 'relatório');
    expect(found).not.toBeNull();
    expect(found?.content).toContain('relatório');
  });

  it('10. findTodoByContent não deve encontrar completed/archived', () => {
    const todo = createTodo(db, { content: 'Tarefa concluída' });
    completeTodo(db, todo.id);

    expect(findTodoByContent(db, 'concluída')).toBeNull();
  });

  it('11. getPendingTodosWithDeadline deve retornar apenas urgentes', () => {
    const now = new Date();
    const soonDate = new Date(now.getTime() + 30 * 60 * 1000).toISOString(); // 30 min from now
    const farDate = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString(); // 5 hours from now
    const pastDate = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // 1 hour ago

    createTodo(db, { content: 'Urgent', target_date: soonDate });
    createTodo(db, { content: 'Far away', target_date: farDate });
    createTodo(db, { content: 'Overdue', target_date: pastDate });
    createTodo(db, { content: 'No date' });

    const urgent = getPendingTodosWithDeadline(db);
    expect(urgent.length).toBe(2); // Urgent + Overdue
    expect(urgent.map(t => t.content)).toContain('Urgent');
    expect(urgent.map(t => t.content)).toContain('Overdue');
  });

  it('12. createTodo deve salvar evento no MemPalace', () => {
    createTodo(db, { content: 'MemPalace test' });
    // Check that MP_Closets has the entry
    const closet = db.prepare("SELECT * FROM MP_Closets WHERE aaak_content LIKE '%MemPalace test%'").get();
    expect(closet).toBeDefined();
    expect(closet.hall_type).toBe('hall_events');
  });

  it('13. completeTodo deve salvar evento no MemPalace como hall_facts', () => {
    const todo = createTodo(db, { content: 'Complete me for MP' });
    completeTodo(db, todo.id);
    const closet = db.prepare("SELECT * FROM MP_Closets WHERE aaak_content LIKE '%Complete me for MP%' AND hall_type = 'hall_facts'").get();
    expect(closet).toBeDefined();
  });
});

