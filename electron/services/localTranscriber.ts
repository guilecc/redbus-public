/**
 * Local Transcriber — Runs whisper-tiny via @xenova/transformers in a worker thread.
 *
 * Architecture: "Ouvido Local + Cérebro em Nuvem"
 *   - whisper-tiny (~77MB) runs locally via WASM — transcribes audio to raw text
 *   - Only the text is sent to the cloud LLM for NLP analysis (cheaper than sending audio)
 *   - Model is cached on disk after first download (~/.cache/redbus-models/)
 *
 * Performance:
 *   - whisper-tiny: ~77MB RAM, runs on any CPU (WASM, no GPU needed)
 *   - Transcription speed: ~1x realtime on modern CPUs (60s audio ≈ 60s processing)
 *   - Runs in a worker thread — does NOT block Electron's main thread
 */

import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

let _workerPath: string | null = null;

/**
 * Get the path to the worker script, creating it on disk if needed.
 * The worker script is generated dynamically to avoid bundler issues with worker_threads.
 */
function getWorkerScriptPath(): string {
  // Always regenerate worker script to pick up code changes
  if (_workerPath && fs.existsSync(_workerPath)) {
    // Still regenerate to ensure latest code
  }

  const cacheDir = path.join(app.getPath('userData'), 'redbus-workers');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  // Create a node_modules symlink so the worker can resolve @xenova/transformers
  const nodeModulesLink = path.join(cacheDir, 'node_modules');
  const projectNodeModules = path.join(app.getAppPath(), 'node_modules');
  if (!fs.existsSync(nodeModulesLink) && fs.existsSync(projectNodeModules)) {
    try {
      fs.symlinkSync(projectNodeModules, nodeModulesLink, 'junction');
      console.log(`[LocalTranscriber] Symlinked node_modules: ${nodeModulesLink} → ${projectNodeModules}`);
    } catch (e) {
      console.warn('[LocalTranscriber] Failed to create node_modules symlink:', e);
    }
  }

  _workerPath = path.join(cacheDir, 'whisper-worker.mjs');

  // Write the worker script (ESM for @xenova/transformers compatibility)
  // Receives Float32Array PCM (already decoded in renderer via OfflineAudioContext)
  const workerCode = `
import { pipeline } from '@xenova/transformers';
import { parentPort, workerData } from 'worker_threads';

async function transcribe() {
  try {
    const { pcmFloat32, cacheDir } = workerData;

    parentPort.postMessage({ type: 'status', message: 'Loading whisper-tiny model (first time may download ~77MB)...' });

    process.env.TRANSFORMERS_CACHE = cacheDir;

    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      cache_dir: cacheDir,
      quantized: true,
    });

    parentPort.postMessage({ type: 'status', message: 'Transcribing audio...' });

    // pcmFloat32 is already Float32Array at 16kHz mono (decoded in renderer)
    const audioData = new Float32Array(pcmFloat32);

    const result = await transcriber(audioData, {
      language: 'portuguese',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });

    const text = typeof result === 'string' ? result : result.text || '';
    parentPort.postMessage({ type: 'result', text });
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: String(err) });
  }
}

transcribe();
`;

  fs.writeFileSync(_workerPath, workerCode, 'utf-8');
  return _workerPath;
}

export interface LocalTranscriptionResult {
  text: string;
  duration_ms: number;
}

/**
 * Transcribe audio locally using whisper-tiny in a worker thread.
 * Receives Float32Array PCM (16kHz mono, already decoded in renderer).
 */
export function transcribeLocally(pcmFloat32: Float32Array): Promise<LocalTranscriptionResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const cacheDir = path.join(app.getPath('userData'), 'redbus-models');

    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    console.log(`[LocalTranscriber] Starting whisper-tiny transcription (${pcmFloat32.length} samples, ${(pcmFloat32.length / 16000).toFixed(1)}s)`);
    console.log(`[LocalTranscriber] Model cache: ${cacheDir}`);

    const workerScript = getWorkerScriptPath();

    const worker = new Worker(workerScript, {
      workerData: {
        pcmFloat32: pcmFloat32.buffer, // Transfer ArrayBuffer (efficient, no copy)
        cacheDir,
      },
    });

    worker.on('message', (msg: { type: string; text?: string; message?: string; error?: string }) => {
      if (msg.type === 'status') {
        console.log(`[LocalTranscriber] ${msg.message}`);
      } else if (msg.type === 'result') {
        const duration_ms = Date.now() - startTime;
        console.log(`[LocalTranscriber] Transcription complete (${duration_ms}ms): "${(msg.text || '').slice(0, 100)}..."`);
        worker.terminate();
        resolve({ text: msg.text || '', duration_ms });
      } else if (msg.type === 'error') {
        console.error(`[LocalTranscriber] Worker error: ${msg.error}`);
        worker.terminate();
        reject(new Error(msg.error));
      }
    });

    worker.on('error', (err) => {
      console.error('[LocalTranscriber] Worker thread error:', err);
      reject(err);
    });

    worker.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Worker exited with code ${code}`));
      }
    });
  });
}

