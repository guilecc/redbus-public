/**
 * Whisper Web Worker — Runs whisper-tiny via @xenova/transformers in the renderer process.
 *
 * Architecture:
 *   - Runs in a Web Worker (separate thread) → does NOT block the Electron UI
 *   - Uses WASM backend (no GPU required)
 *   - Model is cached in IndexedDB by transformers.js after first download (~77MB)
 *   - Receives raw audio ArrayBuffer, decodes via OfflineAudioContext, transcribes, returns text
 *
 * Messages IN:  { audioBuffer: ArrayBuffer, mimeType: string }
 * Messages OUT: { type: 'status', message: string }
 *               { type: 'result', text: string, duration_ms: number }
 *               { type: 'error', error: string }
 */

let transcriber = null;
let pipelineFn = null;

/**
 * Decode audio ArrayBuffer to Float32Array at 16kHz mono (Whisper's expected format).
 * Uses OfflineAudioContext available in Web Workers.
 */
async function decodeAudioToFloat32(audioBuffer, mimeType) {
  // Decode the compressed audio (webm/ogg) to PCM
  const audioCtx = new OfflineAudioContext(1, 16000 * 600, 16000); // mono, up to 10min, 16kHz
  const decoded = await audioCtx.decodeAudioData(audioBuffer.slice(0)); // slice to avoid detached buffer
  // Get mono channel data at the decoded sample rate
  const channelData = decoded.getChannelData(0);

  // If sample rate differs from 16kHz, resample
  if (decoded.sampleRate !== 16000) {
    const resampleCtx = new OfflineAudioContext(1, Math.ceil(channelData.length * 16000 / decoded.sampleRate), 16000);
    const source = resampleCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(resampleCtx.destination);
    source.start(0);
    const resampled = await resampleCtx.startRendering();
    return resampled.getChannelData(0);
  }

  return channelData;
}

self.onmessage = async (event) => {
  const { audioBuffer, mimeType } = event.data;
  const startTime = Date.now();

  try {
    // Step 1: Decode audio to Float32Array at 16kHz
    self.postMessage({ type: 'status', message: 'Decodificando áudio...' });
    let audioFloat32;
    try {
      audioFloat32 = await decodeAudioToFloat32(audioBuffer, mimeType);
    } catch (decodeErr) {
      // Fallback: pass raw buffer and let transformers.js try to handle it
      self.postMessage({ type: 'status', message: 'Decode falhou, tentando formato raw...' });
      audioFloat32 = new Float32Array(audioBuffer);
    }

    // Step 2: Load model (cached after first download)
    self.postMessage({ type: 'status', message: 'Carregando modelo whisper-tiny (~77MB, primeira vez pode demorar)...' });

    if (!pipelineFn) {
      self.postMessage({ type: 'status', message: 'Importando transformers.js...' });
      const mod = await import('@xenova/transformers');
      pipelineFn = mod.pipeline;
    }

    if (!transcriber) {
      transcriber = await pipelineFn('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        quantized: true,
      });
    }

    // Step 3: Transcribe
    self.postMessage({ type: 'status', message: 'Transcrevendo áudio localmente...' });

    const result = await transcriber(audioFloat32, {
      language: 'portuguese',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });

    const text = typeof result === 'string' ? result : (result.text || '');
    const duration_ms = Date.now() - startTime;

    self.postMessage({ type: 'result', text, duration_ms });
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err) });
  }
};

