/**
 * OCR Worker — Processa imagens para texto via tesseract.js.
 *
 * Executa em Worker Thread ou é invocado de forma assíncrona para
 * NUNCA bloquear a Main Thread do Electron.
 *
 * Exporta uma API simples: initOCR(), recognizeImage(buffer), terminateOCR()
 */

import Tesseract from 'tesseract.js';
import path from 'path';

let _worker: Tesseract.Worker | null = null;
let _initializing: Promise<Tesseract.Worker> | null = null;

/**
 * Resolve the Tesseract.js Node worker script path.
 * In dev mode, it lives inside node_modules.
 * Without this, Vite/Electron bundles break the default path resolution.
 */
function resolveWorkerPath(): string {
  // require.resolve gives us the absolute path to the worker script
  try {
    return require.resolve('tesseract.js/src/worker-script/node/index.js');
  } catch {
    // Fallback: manual resolution from project root
    return path.join(__dirname, '..', '..', 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js');
  }
}

/**
 * Initialize the Tesseract worker lazily (singleton).
 * Downloads language data on first call (~15MB for 'eng').
 */
export async function initOCR(): Promise<Tesseract.Worker> {
  if (_worker) return _worker;
  if (_initializing) return _initializing;

  _initializing = (async () => {
    console.log('[OCR] Initializing Tesseract worker...');
    const workerPath = resolveWorkerPath();
    console.log(`[OCR] Worker script path: ${workerPath}`);
    const worker = await Tesseract.createWorker('eng+por', Tesseract.OEM.LSTM_ONLY, {
      workerPath,
      logger: () => { }, // suppress progress logs
    });
    _worker = worker;
    _initializing = null;
    console.log('[OCR] Worker ready');
    return worker;
  })();

  return _initializing;
}

/**
 * Extract text from an image buffer (PNG/JPEG).
 * Returns the extracted text, or empty string on failure.
 */
export async function recognizeImage(imageBuffer: Buffer): Promise<string> {
  try {
    const worker = await initOCR();
    const { data } = await worker.recognize(imageBuffer);
    // Clean up: collapse multiple whitespace, trim empty lines
    return data.text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .join('\n')
      .trim();
  } catch (e) {
    console.error('[OCR] Recognition failed:', e);
    return '';
  }
}

/**
 * Terminate the Tesseract worker to free memory.
 */
export async function terminateOCR(): Promise<void> {
  if (_worker) {
    await _worker.terminate();
    _worker = null;
    console.log('[OCR] Worker terminated');
  }
}

