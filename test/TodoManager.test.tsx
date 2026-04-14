import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { TodoManager } from '../src/components/Todos/TodoManager';

describe('TodoManager UI', () => {
  const mockTodos = [
    { id: '1', content: 'Tarefa pendente', target_date: null, status: 'pending' as const, archived: 0, created_at: '2026-04-13T10:00:00Z' },
    { id: '2', content: 'Tarefa concluída', target_date: null, status: 'completed' as const, archived: 0, created_at: '2026-04-13T09:00:00Z' },
  ];

  beforeEach(() => {
    (window as any).redbusAPI = {
      ...((window as any).redbusAPI || {}),
      listTodos: vi.fn().mockResolvedValue({ status: 'OK', data: mockTodos }),
      createTodo: vi.fn().mockResolvedValue({ status: 'OK', data: { id: '3', content: 'Nova tarefa', target_date: null, status: 'pending', archived: 0, created_at: new Date().toISOString() } }),
      completeTodo: vi.fn().mockResolvedValue({ status: 'OK', data: { completed: true } }),
      archiveTodo: vi.fn().mockResolvedValue({ status: 'OK', data: { archived: true } }),
      unarchiveTodo: vi.fn().mockResolvedValue({ status: 'OK', data: { unarchived: true } }),
      deleteTodo: vi.fn().mockResolvedValue({ status: 'OK', data: { deleted: true } }),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1. Deve renderizar o componente TodoManager', async () => {
    render(<TodoManager />);
    await waitFor(() => {
      expect(screen.getByTestId('todo-manager')).toBeInTheDocument();
    });
  });

  it('2. Deve listar todos os to-dos retornados pela API', async () => {
    render(<TodoManager />);
    await waitFor(() => {
      expect(screen.getByText('Tarefa pendente')).toBeInTheDocument();
      expect(screen.getByText('Tarefa concluída')).toBeInTheDocument();
    });
  });

  it('3. Deve ter campo de input e botão de adicionar', async () => {
    render(<TodoManager />);
    await waitFor(() => {
      expect(screen.getByTestId('todo-input')).toBeInTheDocument();
      expect(screen.getByTestId('todo-add-btn')).toBeInTheDocument();
    });
  });

  it('4. Deve chamar createTodo ao digitar e pressionar Enter', async () => {
    render(<TodoManager />);
    await waitFor(() => {
      expect(screen.getByTestId('todo-input')).toBeInTheDocument();
    });

    const input = screen.getByTestId('todo-input');
    fireEvent.change(input, { target: { value: 'Nova tarefa' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect((window as any).redbusAPI.createTodo).toHaveBeenCalledWith({
        content: 'Nova tarefa',
        target_date: null,
      });
    });
  });

  it('5. Deve chamar completeTodo ao clicar no checkbox de item pendente', async () => {
    render(<TodoManager />);
    await waitFor(() => {
      expect(screen.getByText('Tarefa pendente')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    // First unchecked checkbox belongs to the pending todo
    const pendingCheckbox = checkboxes.find(cb => !(cb as HTMLInputElement).checked && !(cb as HTMLInputElement).disabled);
    expect(pendingCheckbox).toBeDefined();
    if (pendingCheckbox) {
      fireEvent.click(pendingCheckbox);
      await waitFor(() => {
        expect((window as any).redbusAPI.completeTodo).toHaveBeenCalledWith('1');
      });
    }
  });

  it('6. Deve mostrar mensagem vazia quando não há tarefas', async () => {
    (window as any).redbusAPI.listTodos = vi.fn().mockResolvedValue({ status: 'OK', data: [] });
    render(<TodoManager />);
    await waitFor(() => {
      expect(screen.getByText(/nenhuma tarefa/i)).toBeInTheDocument();
    });
  });
});

