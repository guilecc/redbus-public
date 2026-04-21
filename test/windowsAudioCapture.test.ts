/**
 * Tests for windowsAudioCapture — Level 1 native Windows system audio capture.
 *
 * Validates the exact Chromium getUserMedia constraint shape, mic acquisition,
 * Web Audio mixer graph and cleanup semantics (track stops + AudioContext close).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  acquireWindowsSystemAudio,
  acquireMicrophone,
  acquireWindowsMixedStream,
} from '../src/services/windowsAudioCapture';

// ── Test doubles ────────────────────────────────────────────────────────────

function makeTrack(kind: 'audio' | 'video') {
  return { kind, stop: vi.fn(), readyState: 'live' };
}

function makeStream(audioTracks = 1, videoTracks = 0) {
  const tracks = [
    ...Array.from({ length: audioTracks }, () => makeTrack('audio')),
    ...Array.from({ length: videoTracks }, () => makeTrack('video')),
  ];
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
  } as unknown as MediaStream;
}

const mockSourceNode = () => ({ connect: vi.fn(), disconnect: vi.fn() });

function makeAudioContextMock() {
  const destinationStream = makeStream(1, 0);
  const ctx = {
    state: 'running' as 'running' | 'closed',
    createMediaStreamDestination: vi.fn(() => ({ stream: destinationStream })),
    createMediaStreamSource: vi.fn(() => mockSourceNode()),
    close: vi.fn(async function (this: any) { this.state = 'closed'; }),
  };
  return ctx;
}

let currentCtx: ReturnType<typeof makeAudioContextMock>;
let getUserMedia: ReturnType<typeof vi.fn>;
let getDesktopSources: ReturnType<typeof vi.fn>;

beforeEach(() => {
  currentCtx = makeAudioContextMock();
  (globalThis as any).AudioContext = function AudioContext() { return currentCtx; } as any;

  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });

  getDesktopSources = vi.fn();
  (globalThis as any).window.redbusAPI.getDesktopSources = getDesktopSources;
});

afterEach(() => { vi.restoreAllMocks(); });

// ── acquireWindowsSystemAudio ───────────────────────────────────────────────

describe('acquireWindowsSystemAudio', () => {
  it('sends the exact Chromium desktop constraints with a screen source ID', async () => {
    getDesktopSources.mockResolvedValue({
      status: 'OK',
      data: [
        { id: 'window:1:0', name: 'App', type: 'window' },
        { id: 'screen:0:0', name: 'Entire Screen', type: 'screen' },
      ],
    });
    const sysStream = makeStream(1, 1);
    getUserMedia.mockResolvedValue(sysStream);

    const result = await acquireWindowsSystemAudio();

    expect(result).toBe(sysStream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const constraints = getUserMedia.mock.calls[0][0];
    expect(constraints.audio.mandatory).toEqual({
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: 'screen:0:0',
    });
    expect(constraints.video.mandatory).toEqual({
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: 'screen:0:0',
      maxWidth: 1,
      maxHeight: 1,
      frameRate: 1,
    });
  });

  it('falls back to the first source when no screen type is present', async () => {
    getDesktopSources.mockResolvedValue({
      status: 'OK',
      data: [{ id: 'window:42:0', name: 'Teams', type: 'window' }],
    });
    getUserMedia.mockResolvedValue(makeStream());
    await acquireWindowsSystemAudio();
    const constraints = getUserMedia.mock.calls[0][0];
    expect(constraints.audio.mandatory.chromeMediaSourceId).toBe('window:42:0');
  });

  it('throws when desktopCapturer returns no sources', async () => {
    getDesktopSources.mockResolvedValue({ status: 'OK', data: [] });
    await expect(acquireWindowsSystemAudio()).rejects.toThrow(/no sources/i);
  });

  it('propagates permission-denial errors from getUserMedia', async () => {
    getDesktopSources.mockResolvedValue({
      status: 'OK', data: [{ id: 'screen:0:0', name: 'S', type: 'screen' }],
    });
    getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    await expect(acquireWindowsSystemAudio()).rejects.toThrow(/permission denied/i);
  });
});

// ── acquireMicrophone ───────────────────────────────────────────────────────

describe('acquireMicrophone', () => {
  it('requests the default mic when no deviceId is provided', async () => {
    getUserMedia.mockResolvedValue(makeStream());
    await acquireMicrophone();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('pins to an exact deviceId when provided', async () => {
    getUserMedia.mockResolvedValue(makeStream());
    await acquireMicrophone('mic-xyz');
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'mic-xyz' } },
    });
  });
});

// ── acquireWindowsMixedStream ───────────────────────────────────────────────

describe('acquireWindowsMixedStream', () => {
  it('wires mic + system sources into the destination and exposes cleanup', async () => {
    const micStream = makeStream(1, 0);
    const sysStream = makeStream(1, 1);
    getUserMedia.mockResolvedValueOnce(micStream).mockResolvedValueOnce(sysStream);
    getDesktopSources.mockResolvedValue({
      status: 'OK', data: [{ id: 'screen:0:0', name: 'S', type: 'screen' }],
    });

    const result = await acquireWindowsMixedStream(null);

    expect(result.sources.mic).toBe(micStream);
    expect(result.sources.system).toBe(sysStream);
    expect(currentCtx.createMediaStreamDestination).toHaveBeenCalledTimes(1);
    expect(currentCtx.createMediaStreamSource).toHaveBeenCalledTimes(2);
    expect(currentCtx.createMediaStreamSource).toHaveBeenNthCalledWith(1, micStream);
    expect(currentCtx.createMediaStreamSource).toHaveBeenNthCalledWith(2, sysStream);
    expect(result.stream).toBe(currentCtx.createMediaStreamDestination.mock.results[0].value.stream);
  });

  it('falls back to mic-only when loopback acquisition fails', async () => {
    const micStream = makeStream(1, 0);
    getUserMedia
      .mockResolvedValueOnce(micStream)
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    getDesktopSources.mockResolvedValue({
      status: 'OK', data: [{ id: 'screen:0:0', name: 'S', type: 'screen' }],
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const result = await acquireWindowsMixedStream(null);

    expect(result.sources.system).toBeNull();
    expect(currentCtx.createMediaStreamSource).toHaveBeenCalledTimes(1);
    expect(currentCtx.createMediaStreamSource).toHaveBeenCalledWith(micStream);
    expect(warn).toHaveBeenCalled();
  });

  it('cleanup stops every track and closes the AudioContext exactly once', async () => {
    const micStream = makeStream(1, 0);
    const sysStream = makeStream(1, 1);
    getUserMedia.mockResolvedValueOnce(micStream).mockResolvedValueOnce(sysStream);
    getDesktopSources.mockResolvedValue({
      status: 'OK', data: [{ id: 'screen:0:0', name: 'S', type: 'screen' }],
    });

    const result = await acquireWindowsMixedStream(null);
    await result.cleanup();

    micStream.getTracks().forEach(t => expect((t as any).stop).toHaveBeenCalledTimes(1));
    sysStream.getTracks().forEach(t => expect((t as any).stop).toHaveBeenCalledTimes(1));
    expect(currentCtx.close).toHaveBeenCalledTimes(1);
    expect(currentCtx.state).toBe('closed');
  });

  it('cleanup does not re-close an already-closed AudioContext', async () => {
    const micStream = makeStream(1, 0);
    getUserMedia
      .mockResolvedValueOnce(micStream)
      .mockRejectedValueOnce(new Error('loopback off'));
    getDesktopSources.mockResolvedValue({
      status: 'OK', data: [{ id: 'screen:0:0', name: 'S', type: 'screen' }],
    });
    vi.spyOn(console, 'warn').mockImplementation(() => { });

    const result = await acquireWindowsMixedStream(null);
    currentCtx.state = 'closed';
    await result.cleanup();
    expect(currentCtx.close).not.toHaveBeenCalled();
  });

  it('forwards the mic deviceId through to getUserMedia', async () => {
    getUserMedia
      .mockResolvedValueOnce(makeStream())
      .mockResolvedValueOnce(makeStream(1, 1));
    getDesktopSources.mockResolvedValue({
      status: 'OK', data: [{ id: 'screen:0:0', name: 'S', type: 'screen' }],
    });
    await acquireWindowsMixedStream('mic-123');
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: { deviceId: { exact: 'mic-123' } },
    });
  });
});


