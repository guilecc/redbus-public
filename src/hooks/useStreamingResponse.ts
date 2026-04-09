import { useState, useEffect, useCallback, useRef } from 'react';
import type { StreamEvent, StreamEventType } from '../types/ipc';

export interface ToolStatus {
  toolName: string;
  label: string;
  icon: string;
  status: 'running' | 'done';
  startTime: number;
  durationMs?: number;
}

export interface StreamingState {
  /** Whether the pipeline is currently active */
  isActive: boolean;
  /** Whether the Maestro is thinking/reasoning */
  isThinking: boolean;
  /** Accumulated thinking text */
  thinkingText: string;
  /** Whether the response is being streamed */
  isStreaming: boolean;
  /** Accumulated response text (token-by-token) */
  streamedText: string;
  /** Active and completed tool executions */
  tools: ToolStatus[];
  /** Whether a worker is currently running */
  workerActive: boolean;
  /** Worker label */
  workerLabel: string;
  /** Current requestId being tracked */
  requestId: string | null;
}

const INITIAL_STATE: StreamingState = {
  isActive: false,
  isThinking: false,
  thinkingText: '',
  isStreaming: false,
  streamedText: '',
  tools: [],
  workerActive: false,
  workerLabel: '',
  requestId: null,
};

/**
 * Hook that consumes streaming events from the main process
 * and maintains progressive UI state.
 */
export function useStreamingResponse() {
  const [state, setState] = useState<StreamingState>(INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const handler = (event: StreamEvent) => {
      const s = stateRef.current;

      switch (event.type) {
        case 'pipeline-start':
          setState({ ...INITIAL_STATE, isActive: true, requestId: event.requestId });
          break;

        case 'pipeline-end':
          setState(prev => ({ ...prev, isActive: false, isThinking: false, isStreaming: false, workerActive: false }));
          break;

        case 'thinking-start':
          setState(prev => ({ ...prev, isThinking: true, thinkingText: '' }));
          break;

        case 'thinking-chunk':
          setState(prev => ({ ...prev, thinkingText: prev.thinkingText + (event.chunk || '') }));
          break;

        case 'thinking-end':
          setState(prev => ({ ...prev, isThinking: false }));
          break;

        case 'tool-start':
          setState(prev => ({
            ...prev,
            tools: [...prev.tools, {
              toolName: event.toolName || 'unknown',
              label: event.toolLabel || event.toolName || 'Executando...',
              icon: event.toolIcon || '⚡',
              status: 'running',
              startTime: event.ts,
            }],
          }));
          break;

        case 'tool-end':
          setState(prev => ({
            ...prev,
            tools: prev.tools.map(t =>
              t.toolName === event.toolName && t.status === 'running'
                ? { ...t, status: 'done' as const, durationMs: event.durationMs }
                : t
            ),
          }));
          break;

        case 'response-start':
          setState(prev => ({ ...prev, isStreaming: true, streamedText: '' }));
          break;

        case 'response-chunk':
          setState(prev => ({ ...prev, streamedText: event.accumulated || (prev.streamedText + (event.chunk || '')) }));
          break;

        case 'response-end':
          setState(prev => ({ ...prev, isStreaming: false }));
          break;

        case 'worker-start':
          setState(prev => ({ ...prev, workerActive: true, workerLabel: event.toolLabel || 'Processando...' }));
          break;

        case 'worker-end':
          setState(prev => ({ ...prev, workerActive: false }));
          break;

        case 'error':
          setState(prev => ({ ...prev, isActive: false, isThinking: false, isStreaming: false }));
          break;
      }
    };

    window.redbusAPI.onStreamEvent(handler);
    return () => { window.redbusAPI.removeStreamEventListener(); };
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { ...state, reset };
}

