/**
 * StreamBus — Real-time event streaming from main process to renderer.
 *
 * Emits granular events during orchestrator/LLM processing so the UI
 * can show progressive feedback (thinking, tool usage, streaming text).
 *
 * Events are sent via webContents.send('stream:event', event) to the
 * renderer process, which consumes them via ipcRenderer.on('stream:event').
 */
import { BrowserWindow } from 'electron';

export type StreamEventType =
  | 'thinking-start'
  | 'thinking-chunk'
  | 'thinking-end'
  | 'tool-start'
  | 'tool-end'
  | 'response-start'
  | 'response-chunk'
  | 'response-end'
  | 'worker-start'
  | 'worker-end'
  | 'pipeline-start'
  | 'pipeline-end'
  | 'error';

export interface StreamEvent {
  /** Unique request ID to correlate events with a specific user message */
  requestId: string;
  type: StreamEventType;
  /** Incremental text chunk (for thinking-chunk, response-chunk) */
  chunk?: string;
  /** Tool/action name (for tool-start, tool-end) */
  toolName?: string;
  /** Human-readable label for the tool action */
  toolLabel?: string;
  /** Tool icon hint (emoji) */
  toolIcon?: string;
  /** Duration in ms (for tool-end) */
  durationMs?: number;
  /** Full accumulated text so far (for response-chunk) */
  accumulated?: string;
  /** Error message */
  error?: string;
  /** Timestamp */
  ts: number;
}

let _mainWindow: BrowserWindow | null = null;

export function initStreamBus(mainWindow: BrowserWindow): void {
  _mainWindow = mainWindow;
}

function send(event: StreamEvent): void {
  try {
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('stream:event', event);
    }
  } catch { /* non-fatal */ }
}

// ── Convenience emitters ──

export function emitPipelineStart(requestId: string): void {
  send({ requestId, type: 'pipeline-start', ts: Date.now() });
}

export function emitPipelineEnd(requestId: string): void {
  send({ requestId, type: 'pipeline-end', ts: Date.now() });
}

export function emitThinkingStart(requestId: string): void {
  send({ requestId, type: 'thinking-start', ts: Date.now() });
}

export function emitThinkingChunk(requestId: string, chunk: string): void {
  send({ requestId, type: 'thinking-chunk', chunk, ts: Date.now() });
}

export function emitThinkingEnd(requestId: string): void {
  send({ requestId, type: 'thinking-end', ts: Date.now() });
}

export function emitToolStart(requestId: string, toolName: string, toolLabel: string, toolIcon = '⚡'): void {
  send({ requestId, type: 'tool-start', toolName, toolLabel, toolIcon, ts: Date.now() });
}

export function emitToolEnd(requestId: string, toolName: string, durationMs: number): void {
  send({ requestId, type: 'tool-end', toolName, durationMs, ts: Date.now() });
}

export function emitResponseStart(requestId: string): void {
  send({ requestId, type: 'response-start', ts: Date.now() });
}

export function emitResponseChunk(requestId: string, chunk: string, accumulated: string): void {
  send({ requestId, type: 'response-chunk', chunk, accumulated, ts: Date.now() });
}

export function emitResponseEnd(requestId: string): void {
  send({ requestId, type: 'response-end', ts: Date.now() });
}

export function emitWorkerStart(requestId: string, label: string): void {
  send({ requestId, type: 'worker-start', toolLabel: label, ts: Date.now() });
}

export function emitWorkerEnd(requestId: string, durationMs: number): void {
  send({ requestId, type: 'worker-end', durationMs, ts: Date.now() });
}

export function emitError(requestId: string, error: string): void {
  send({ requestId, type: 'error', error, ts: Date.now() });
}

