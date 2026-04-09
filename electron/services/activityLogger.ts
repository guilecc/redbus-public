/**
 * ActivityLogger — Console de Logs em Tempo Real do RedBus.
 *
 * Mantém buffer circular em RAM (últimos 500 eventos) e emite via IPC
 * para o renderer. Logs críticos são opcionalmente persistidos no SQLite.
 *
 * Categorias: sensors | meetings | routines | proactivity | orchestrator
 */

import type { BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';

/* ── Tipos ── */

export type ActivityCategory = 'sensors' | 'meetings' | 'routines' | 'proactivity' | 'orchestrator' | 'inbox';

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  message: string;
  metadata?: any;
}

/* ── Estado interno ── */

const MAX_BUFFER_SIZE = 500;
let _buffer: ActivityLogEntry[] = [];
let _mainWindow: BrowserWindow | null = null;
let _db: any = null;

/* ── API Pública ── */

/**
 * Inicializar o ActivityLogger com referências do main process.
 */
export function initActivityLogger(mainWindow: BrowserWindow, db?: any): void {
  _mainWindow = mainWindow;
  if (db) _db = db;
}

/**
 * Registrar uma atividade no console de logs.
 *
 * @param category Categoria do log (sensors, meetings, routines, proactivity, orchestrator)
 * @param message Mensagem descritiva do evento
 * @param metadata Dados extras opcionais (serializados como JSON)
 * @param persist Se true, persiste no SQLite (usar para logs críticos)
 */
export function logActivity(
  category: ActivityCategory,
  message: string,
  metadata?: any,
  persist = false,
): void {
  const entry: ActivityLogEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    category,
    message,
    metadata,
  };

  // Adicionar ao buffer circular
  _buffer.push(entry);
  if (_buffer.length > MAX_BUFFER_SIZE) {
    _buffer = _buffer.slice(_buffer.length - MAX_BUFFER_SIZE);
  }

  // Emitir via IPC para o renderer
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('activity:log-entry', entry);
  }

  // Persistir no SQLite se marcado como crítico
  if (persist && _db) {
    try {
      _db.prepare(`
        INSERT INTO ActivityLog (id, timestamp, category, message, metadata_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        entry.id,
        entry.timestamp,
        entry.category,
        entry.message,
        metadata ? JSON.stringify(metadata) : null,
      );
    } catch (err) {
      console.error('[ActivityLogger] Erro ao persistir log:', err);
    }
  }
}

/**
 * Obter logs recentes do buffer em memória.
 * @param limit Número máximo de logs a retornar (default: 100)
 */
export function getRecentLogs(limit = 100): ActivityLogEntry[] {
  if (limit >= _buffer.length) return [..._buffer];
  return _buffer.slice(_buffer.length - limit);
}

/**
 * Limpar o buffer em memória (não apaga do SQLite).
 */
export function clearLogBuffer(): void {
  _buffer = [];
}

/**
 * Reset completo (para testes).
 */
export function _resetActivityLogger(): void {
  _buffer = [];
  _mainWindow = null;
  _db = null;
}

