/**
 * windowsAudioCapture — Windows native system audio (loopback) capture via Chromium.
 *
 * Level 1 of the audio architecture: uses Electron's desktopCapturer to obtain a
 * screen source ID and feeds it into navigator.mediaDevices.getUserMedia with the
 * Chromium-specific `chromeMediaSource: 'desktop'` constraints. The loopback audio
 * is then mixed with the default microphone through the Web Audio API, producing
 * a single MediaStream that can be consumed by MediaRecorder (audio/webm;codecs=opus).
 *
 * No driver required: Electron's setDisplayMediaRequestHandler is configured in the
 * main process to permit `audio: 'loopback'`, backing WASAPI capture on Windows.
 */

export interface WindowsMixedStream {
  /** Mixed MediaStream (system loopback + microphone) ready for MediaRecorder. */
  stream: MediaStream;
  /** Underlying streams, exposed so callers can track/stop them individually. */
  sources: { system: MediaStream | null; mic: MediaStream };
  /** AudioContext owning the mixer graph. */
  audioContext: AudioContext;
  /** Tear down the mixer graph, stop all tracks and close the AudioContext. */
  cleanup: () => Promise<void>;
}

type DesktopCaptureConstraints = {
  mandatory: {
    chromeMediaSource: 'desktop';
    chromeMediaSourceId: string;
    maxWidth?: number;
    maxHeight?: number;
    frameRate?: number;
  };
};

/**
 * Resolve the primary desktop source ID via the main-process IPC bridge.
 * Prefers a screen source (full desktop loopback); falls back to the first window.
 */
async function resolveDesktopSourceId(): Promise<string> {
  const res = await window.redbusAPI.getDesktopSources();
  if (res.status !== 'OK' || !res.data || res.data.length === 0) {
    throw new Error('desktop:get-sources returned no sources');
  }
  const screenSource = res.data.find(s => s.type === 'screen') ?? res.data[0];
  return screenSource.id;
}

/**
 * Acquire a Windows system-audio (loopback) MediaStream using Chromium's
 * `chromeMediaSource: 'desktop'` constraints. The returned stream may carry a
 * 1×1 @ 1fps video track (required by Chromium to honor the audio constraint);
 * callers must stop every track during cleanup.
 */
export async function acquireWindowsSystemAudio(): Promise<MediaStream> {
  const sourceId = await resolveDesktopSourceId();

  const audioConstraint: DesktopCaptureConstraints = {
    mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId },
  };
  const videoConstraint: DesktopCaptureConstraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxWidth: 1,
      maxHeight: 1,
      frameRate: 1,
    },
  };

  return navigator.mediaDevices.getUserMedia({
    audio: audioConstraint,
    video: videoConstraint,
  } as unknown as MediaStreamConstraints);
}

/**
 * Acquire the default microphone, optionally pinned to a specific deviceId.
 */
export async function acquireMicrophone(deviceId?: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });
}

/**
 * High-level helper: acquires loopback + mic, mixes them through a Web Audio graph
 * and returns a single MediaStream compatible with the existing MediaRecorder flow.
 * If loopback acquisition fails (e.g. user denied screen capture), the returned
 * stream contains microphone audio only and `sources.system` is `null`.
 */
export async function acquireWindowsMixedStream(
  micDeviceId?: string | null,
): Promise<WindowsMixedStream> {
  const micStream = await acquireMicrophone(micDeviceId);

  let systemStream: MediaStream | null = null;
  try {
    systemStream = await acquireWindowsSystemAudio();
  } catch (err) {
    console.warn('[windowsAudioCapture] loopback unavailable, mic-only:', err);
    systemStream = null;
  }

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  const nodes: MediaStreamAudioSourceNode[] = [];
  nodes.push(audioContext.createMediaStreamSource(micStream));
  if (systemStream && systemStream.getAudioTracks().length > 0) {
    nodes.push(audioContext.createMediaStreamSource(systemStream));
  }
  nodes.forEach(node => node.connect(destination));

  const cleanup = async () => {
    nodes.forEach(node => { try { node.disconnect(); } catch { /* noop */ } });
    micStream.getTracks().forEach(t => t.stop());
    if (systemStream) systemStream.getTracks().forEach(t => t.stop());
    if (audioContext.state !== 'closed') {
      try { await audioContext.close(); } catch { /* noop */ }
    }
  };

  return {
    stream: destination.stream,
    sources: { system: systemStream, mic: micStream },
    audioContext,
    cleanup,
  };
}

/**
 * Runtime guard mirroring the `isWindows` check used elsewhere in the renderer.
 */
export function isWindowsPlatform(): boolean {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
}

