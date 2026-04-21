import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChatInput } from '../src/components/Chat/ChatInput';
import { AgentTaskProgress } from '../src/components/Chat/AgentTaskProgress';

describe('Chat UI Components', () => {
  it('1. ChatInput deve chamar onSend ao clicar no botão', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    
    const textarea = screen.getByPlaceholderText(/run a task/i);
    const button = screen.getAllByRole('button').find(b => b.classList.contains('send-button'))!;
    
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.click(button);
    
    expect(onSend).toHaveBeenCalledWith('Test message', undefined);
    expect(textarea).toHaveValue('');
  });

  it('2. AgentTaskProgress deve mostrar passos ao ser expandido', () => {
    const steps = [
      { label: 'Step 1', status: 'completed' as const },
      { label: 'Step 2', status: 'running' as const }
    ];
    render(<AgentTaskProgress goal="Test Goal" steps={steps} status="running" />);
    
    expect(screen.getByText('Test Goal')).toBeInTheDocument();
    
    // Expand
    fireEvent.click(screen.getByText('Test Goal'));
    
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Step 2')).toBeInTheDocument();
  });
});
