import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityConsole } from '../src/components/ActivityConsole/ActivityConsole';

// Store the callback registered via onActivityLogEntry so we can invoke it in tests
let activityLogCallback: ((entry: any) => void) | null = null;

const mockLogs = [
  { id: '1', timestamp: '2026-03-18T10:00:00.000Z', category: 'sensors', message: 'Clipboard: novo conteúdo' },
  { id: '2', timestamp: '2026-03-18T10:00:01.000Z', category: 'meetings', message: 'Reunião salva' },
  { id: '3', timestamp: '2026-03-18T10:00:02.000Z', category: 'routines', message: 'Rotina disparada' },
  { id: '4', timestamp: '2026-03-18T10:00:03.000Z', category: 'proactivity', message: 'Sugestão gerada' },
  { id: '5', timestamp: '2026-03-18T10:00:04.000Z', category: 'orchestrator', message: 'Living Spec criado' },
];

beforeEach(() => {
  activityLogCallback = null;
  (window as any).redbusAPI = {
    getRecentActivityLogs: vi.fn().mockResolvedValue({ status: 'OK', data: [] }),
    clearActivityLogs: vi.fn().mockResolvedValue({ status: 'OK' }),
    onActivityLogEntry: vi.fn((cb: (entry: any) => void) => {
      activityLogCallback = cb;
    }),
  };
});

describe('ActivityConsole', () => {
  // ── Test 1: Renders empty initially ──
  it('1. Deve renderizar vazio inicialmente', async () => {
    render(<ActivityConsole isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('activity-console')).toBeInTheDocument();
    });

    // No log items rendered
    expect(screen.queryByTestId('activity-log-item')).not.toBeInTheDocument();
  });

  // ── Test 2: Receives logs via IPC and displays them ──
  it('2. Deve receber logs via IPC e exibir na lista', async () => {
    (window as any).redbusAPI.getRecentActivityLogs.mockResolvedValue({
      status: 'OK', data: mockLogs,
    });

    render(<ActivityConsole isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Clipboard: novo conteúdo')).toBeInTheDocument();
      expect(screen.getByText('Reunião salva')).toBeInTheDocument();
      expect(screen.getByText('Living Spec criado')).toBeInTheDocument();
    });
  });

  // ── Test 3: Receives real-time log via IPC callback ──
  it('3. Deve receber log em tempo real via callback IPC', async () => {
    render(<ActivityConsole isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('activity-console')).toBeInTheDocument();
    });

    // Simulate real-time log entry
    act(() => {
      if (activityLogCallback) {
        activityLogCallback({
          id: '99', timestamp: '2026-03-18T12:00:00.000Z',
          category: 'sensors', message: 'Real-time event',
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByText('Real-time event')).toBeInTheDocument();
    });
  });

  // ── Test 4: Category filters work ──
  it('4. Filtros por categoria devem funcionar', async () => {
    (window as any).redbusAPI.getRecentActivityLogs.mockResolvedValue({
      status: 'OK', data: mockLogs,
    });

    render(<ActivityConsole isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Clipboard: novo conteúdo')).toBeInTheDocument();
    });

    // Uncheck sensors filter
    const sensorsFilter = screen.getByTestId('filter-sensors');
    fireEvent.click(sensorsFilter);

    // Sensors log should be hidden
    expect(screen.queryByText('Clipboard: novo conteúdo')).not.toBeInTheDocument();
    // Other logs should still be visible
    expect(screen.getByText('Reunião salva')).toBeInTheDocument();
  });

  // ── Test 5: Toggle open/close ──
  it('5. Toggle abrir/fechar deve funcionar', () => {
    const { rerender } = render(<ActivityConsole isOpen={false} onClose={vi.fn()} />);

    // When closed, should not render console content
    expect(screen.queryByTestId('activity-console')).not.toBeInTheDocument();

    // Open it
    rerender(<ActivityConsole isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('activity-console')).toBeInTheDocument();
  });

  // ── Test 6: Close button calls onClose ──
  it('6. Botão de fechar deve chamar onClose', async () => {
    const onClose = vi.fn();
    render(<ActivityConsole isOpen={true} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId('activity-console')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('activity-console-close'));
    expect(onClose).toHaveBeenCalled();
  });

  // ── Test 7: Display limit of 100 logs ──
  it.skip('7. Deve limitar a exibição a 100 logs', async () => {
    const manyLogs = Array.from({ length: 120 }, (_, i) => ({
      id: String(i), timestamp: '2026-03-18T10:00:00.000Z',
      category: 'sensors' as const, message: `Log ${i}`,
    }));

    (window as any).redbusAPI.getRecentActivityLogs.mockResolvedValue({
      status: 'OK', data: manyLogs,
    });

    render(<ActivityConsole isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      const items = screen.getAllByTestId('activity-log-item');
      expect(items.length).toBeLessThanOrEqual(100);
    });
  });
});

