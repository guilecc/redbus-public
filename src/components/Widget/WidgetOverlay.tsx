import React, { useState, useEffect, useRef, useCallback } from 'react';
import { acquireWindowsMixedStream } from '../../services/windowsAudioCapture';

type WidgetPhase = 'setup' | 'ready' | 'recording' | 'loading';
interface OutputDevice { id: number; name: string; uid: string; hasOutput: boolean; hasInput: boolean; }
interface AggregateInfo { aggregateID: number; aggregateUID: string; aggregateName: string; redbusUID: string; }

/**
 * WidgetOverlay — Floating recording widget with 3-phase flow:
 *   setup  → select output device + create Multi-Output
 *   ready  → show instruction + REC enabled
 *   recording → timer + STOP
 *   loading → processing animation
 */
export const WidgetOverlay: React.FC = () => {
  const [phase, setPhase] = useState<WidgetPhase>('setup');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Setup state
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([]);
  const [selectedOutputUID, setSelectedOutputUID] = useState('');
  const [driverMissing, setDriverMissing] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [aggregateInfo, setAggregateInfo] = useState<AggregateInfo | null>(null);
  const [creating, setCreating] = useState(false);

  // Audio refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const isMac = navigator.userAgent.includes('Mac');
  const isWindows = navigator.userAgent.includes('Windows');
  const isLinux = navigator.userAgent.includes('Linux');

  // Force transparent background + platform-specific init
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const root = document.getElementById('root');
    if (root) root.style.background = 'transparent';

    if (isMac) {
      loadOutputDevices();
    } else {
      // Windows & Linux: no manual setup needed, go straight to ready
      setPhase('ready');
    }
  }, []);

  const loadOutputDevices = async () => {
    try {
      // Check driver + existing Multi-Output
      const driverRes = await window.redbusAPI.checkAudioDriver();
      if (driverRes.status !== 'OK' || !driverRes.data?.driverInstalled) {
        setDriverMissing(true);
        return;
      }

      // If Multi-Output already exists (needsSetup === false), skip setup
      if (!driverRes.data.needsSetup) {
        // Find the existing Multi-Output device name
        const devRes = await window.redbusAPI.listOutputDevices();
        const multiDev = devRes.status === 'OK' && devRes.data
          ? devRes.data.find(d => d.name.includes('Multi-Output') || d.name.includes('RedBus Multi'))
          : null;
        setAggregateInfo({
          aggregateID: 0, // not managed by us — user created it
          aggregateUID: multiDev?.uid || '',
          aggregateName: multiDev?.name || 'Multi-Output Device',
          redbusUID: driverRes.data.redbusUID || '',
        });
        setPhase('ready');
        console.log('[Widget] ✅ Existing Multi-Output detected, skipping setup');
        return;
      }

      // No Multi-Output yet — show setup UI
      const res = await window.redbusAPI.listOutputDevices();
      if (res.status === 'OK' && res.data) {
        setOutputDevices(res.data);
        if (res.data.length > 0) setSelectedOutputUID(res.data[0].uid);
      }
    } catch (e) { console.error('[Widget] Failed to load devices:', e); }
  };

  // ── Create aggregate ──
  const handleCreateAggregate = async () => {
    if (!selectedOutputUID || creating) return;
    setCreating(true);
    setSetupError(null);
    try {
      const res = await window.redbusAPI.createAggregate(selectedOutputUID);
      if (res.status === 'OK' && res.data) {
        setAggregateInfo(res.data);
        setPhase('ready');
        console.log('[Widget] ✅ Aggregate created:', res.data);
      } else {
        setSetupError(res.error || 'Erro ao criar dispositivo');
      }
    } catch (e: any) {
      setSetupError(e.message || 'Erro ao criar dispositivo');
    } finally {
      setCreating(false);
    }
  };

  // Resize widget window based on phase
  useEffect(() => {
    if (phase === 'setup') {
      window.redbusAPI.resizeWidget(310, 200);
    } else if (phase === 'ready' && isMac && aggregateInfo) {
      window.redbusAPI.resizeWidget(310, 180);
    } else if (phase === 'recording' || phase === 'loading') {
      window.redbusAPI.resizeWidget(220, 88);
    } else {
      // ready (non-mac) — compact pill
      window.redbusAPI.resizeWidget(220, 88);
    }
  }, [phase, aggregateInfo]);

  // Recording timer
  useEffect(() => {
    if (phase === 'recording') {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  // ── Cleanup all streams ──
  const cleanupStreams = useCallback(async () => {
    streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    streamsRef.current = [];
    if (audioCtxRef.current) { await audioCtxRef.current.close(); audioCtxRef.current = null; }
  }, []);

  // ── Acquire system audio stream (platform-specific) ──
  // Note: Windows is handled inline in startRecording via acquireWindowsMixedStream
  // (Level 1 native capture — WASAPI loopback through Chromium's desktopCapturer).
  const acquireSystemAudio = async (): Promise<MediaStream | null> => {
    if (isLinux) {
      // Linux: find PulseAudio/PipeWire monitor source in enumerateDevices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      const monitorDevice = audioInputs.find(d =>
        d.label.toLowerCase().includes('monitor') || d.label.includes('.monitor')
      );
      if (monitorDevice) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: monitorDevice.deviceId } },
          });
          console.log(`[Widget] ✅ Linux monitor source: ${monitorDevice.label}`);
          return stream;
        } catch (e) {
          console.warn('[Widget] Linux monitor source failed:', e);
        }
      } else {
        console.warn('[Widget] No PulseAudio/PipeWire monitor source found in enumerateDevices');
      }
      // Fallback: try system device from settings
      const sysIdRes = await window.redbusAPI.getAppSetting('audio_system_device_id');
      const sysId = sysIdRes.status === 'OK' ? sysIdRes.data : null;
      if (sysId) {
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: sysId } } });
        } catch { /* fall through */ }
      }
      return null;
    }

    // macOS: find RedBusAudio input
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    const redbusInput = audioInputs.find(d => d.label.includes('RedBusAudio') || d.label.includes('RedBus'));
    if (redbusInput) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: redbusInput.deviceId } },
        });
        console.log(`[Widget] ✅ macOS RedBusAudio: ${redbusInput.label}`);
        return stream;
      } catch (e) {
        console.warn('[Widget] RedBusAudio capture failed:', e);
      }
    }
    // Fallback: manual system device from settings
    const sysIdRes = await window.redbusAPI.getAppSetting('audio_system_device_id');
    const sysId = sysIdRes.status === 'OK' ? sysIdRes.data : null;
    if (sysId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: sysId } } });
      } catch { /* fall through */ }
    }
    return null;
  };

  // ── Start recording ──
  const startRecording = useCallback(async () => {
    try {
      const micIdRes = await window.redbusAPI.getAppSetting('audio_mic_device_id');
      const micDeviceId = micIdRes.status === 'OK' ? micIdRes.data : null;

      let mixedStream: MediaStream;

      if (isWindows) {
        // Level 1 native capture: mic + WASAPI loopback mixed via Web Audio.
        const mixed = await acquireWindowsMixedStream(micDeviceId);
        audioCtxRef.current = mixed.audioContext;
        const tracked: MediaStream[] = [mixed.sources.mic];
        if (mixed.sources.system) tracked.push(mixed.sources.system);
        streamsRef.current = tracked;
        mixedStream = mixed.stream;
        console.log(
          mixed.sources.system
            ? '[Widget] ✅ Windows WASAPI loopback + mic mixed into recording'
            : '[Widget] Recording with mic only (Windows loopback unavailable)',
        );
      } else {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
        });

        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const destination = audioCtx.createMediaStreamDestination();
        audioCtx.createMediaStreamSource(micStream).connect(destination);
        const streams: MediaStream[] = [micStream];

        // Acquire system audio (platform-specific)
        const sysStream = await acquireSystemAudio();
        if (sysStream) {
          const sysSource = audioCtx.createMediaStreamSource(sysStream);
          sysSource.connect(destination);
          streams.push(sysStream);
          console.log('[Widget] ✅ System audio mixed into recording');
        } else {
          console.warn('[Widget] Recording with mic only (no system audio)');
        }
        streamsRef.current = streams;
        mixedStream = destination.stream;
      }

      // MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(mixedStream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        await cleanupStreams();
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const arrayBuffer = await blob.arrayBuffer();
        console.log(`[Widget] Recording stopped. ${(arrayBuffer.byteLength / 1024).toFixed(0)} KB`);

        setPhase('loading');

        const openReview = (data: any) => {
          setPhase('setup');
          window.redbusAPI.showMeetingReview(data);
        };

        const handleCloudFallback = async () => {
          console.log('[Widget] Processing via cloud...');
          const res = await window.redbusAPI.processMeetingAudio(arrayBuffer, mimeType);
          if (res.status === 'OK' && res.data) {
            openReview({ raw_transcript: res.data.raw_transcript || '', summary_json: res.data.summary, provider_used: res.data.provider_used || 'cloud' });
          } else {
            console.error('[Widget] Cloud processing failed:', res.error);
            setPhase('setup');
          }
        };

        try {
          // Route by transcription mode
          const modeRes = await window.redbusAPI.getAppSetting('transcription_mode');
          const mode = modeRes.status === 'OK' && modeRes.data === 'HYBRID_LOCAL' ? 'HYBRID_LOCAL' : 'FULL_CLOUD';
          console.log(`[Widget] Transcription mode: ${mode}`);

          if (mode === 'HYBRID_LOCAL') {
            // HYBRID_LOCAL: decode audio to PCM in renderer (has OfflineAudioContext)
            // then send Float32 PCM to main process for local STT
            console.log('[Widget] HYBRID_LOCAL: decoding audio to PCM...');
            try {
              const audioCtx = new OfflineAudioContext(1, 16000 * 600, 16000);
              const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
              let pcm = decoded.getChannelData(0);
              // Resample to 16kHz if needed
              if (decoded.sampleRate !== 16000) {
                const resampleCtx = new OfflineAudioContext(1, Math.ceil(pcm.length * 16000 / decoded.sampleRate), 16000);
                const src = resampleCtx.createBufferSource();
                src.buffer = decoded;
                src.connect(resampleCtx.destination);
                src.start(0);
                const resampled = await resampleCtx.startRendering();
                pcm = resampled.getChannelData(0);
              }
              console.log(`[Widget] HYBRID_LOCAL: PCM ready (${pcm.length} samples, ${(pcm.length / 16000).toFixed(1)}s)`);
              const res = await window.redbusAPI.processHybridLocal(pcm.buffer, 'pcm-f32');
              if (res.status === 'OK' && res.data) {
                openReview({ raw_transcript: res.data.raw_transcript || '', summary_json: res.data.summary, provider_used: res.data.provider_used || 'local' });
              } else {
                console.warn('[Widget] HYBRID_LOCAL failed, falling back to cloud:', res.error);
                await handleCloudFallback();
              }
            } catch (decodeErr) {
              console.warn('[Widget] Audio decode failed, falling back to cloud:', decodeErr);
              await handleCloudFallback();
            }
          } else {
            await handleCloudFallback();
          }
        } catch (err) {
          console.error('[Widget] Processing failed:', err);
          setPhase('setup');
        }
      };

      recorder.start(10_000);
      mediaRecorderRef.current = recorder;
      setPhase('recording');
      console.log('[Widget] Recording started');
    } catch (err) {
      console.error('[Widget] Failed to start recording:', err);
    }
  }, [cleanupStreams]);

  // ── Stop recording + cleanup aggregate ──
  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    // Destroy aggregate on stop — only if we created it (aggregateID > 0)
    if (aggregateInfo && aggregateInfo.aggregateID > 0) {
      try {
        await window.redbusAPI.destroyAggregate(aggregateInfo.aggregateID);
        console.log('[Widget] Aggregate destroyed');
      } catch { /* non-fatal */ }
      setAggregateInfo(null);
    }
  }, [aggregateInfo]);

  // ── Render by phase ──
  const stateClass = phase === 'loading' ? 'loading' : phase === 'recording' ? 'recording' : 'idle';

  // SETUP phase: select output device + create button
  if (phase === 'setup' && isMac) {
    return (
      <div className="widget-pill idle widget-expanded" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="widget-setup" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {driverMissing ? (
            <span className="widget-status-text" style={{ color: '#f87171', fontSize: '11px' }}>
              ⚠️ Driver RedBusAudio não encontrado
            </span>
          ) : (
            <>
              <label className="widget-label">Saída de áudio:</label>
              <select
                className="widget-select"
                value={selectedOutputUID}
                onChange={e => setSelectedOutputUID(e.target.value)}
              >
                {outputDevices.map(d => (
                  <option key={d.uid} value={d.uid}>{d.name}</option>
                ))}
              </select>
              <button
                className="widget-create-btn"
                onClick={handleCreateAggregate}
                disabled={creating || !selectedOutputUID}
              >
                {creating ? '⏳ Criando...' : '🔊 Criar Multi-Output'}
              </button>
              {setupError && (
                <span className="widget-error">{setupError}</span>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // READY phase: instruction + REC button
  if (phase === 'ready' && isMac && aggregateInfo) {
    return (
      <div className="widget-pill idle widget-expanded" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="widget-ready" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <span className="widget-instruction">
            No seu app de conversa, selecione <strong>"{aggregateInfo.aggregateName}"</strong> como saída de áudio.
          </span>
          <button className="widget-action idle" onClick={startRecording}>
            <div className="widget-rec-dot" />
          </button>
          <span className="widget-status-text idle" style={{ marginLeft: '4px' }}>Gravar</span>
        </div>
      </div>
    );
  }

  // RECORDING / LOADING / READY (non-mac) — original pill layout
  return (
    <div className={`widget-pill ${stateClass}`} style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      {phase === 'recording' && <div className="widget-ring" />}

      <button
        className={`widget-action ${stateClass}`}
        onClick={phase === 'recording' ? stopRecording : phase === 'ready' ? startRecording : undefined}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        disabled={phase === 'loading'}
      >
        {phase === 'loading' ? (
          <div className="widget-orbit">
            <div className="widget-orbit-dot" />
            <div className="widget-orbit-dot d2" />
            <div className="widget-orbit-dot d3" />
          </div>
        ) : phase === 'recording' ? (
          <div className="widget-stop-sq" />
        ) : (
          <div className="widget-rec-dot" />
        )}
      </button>

      <div className="widget-info" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {phase === 'loading' ? (
          <>
            <span className="widget-status-text processing">Gerando ata</span>
            <span className="widget-status-dots">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </span>
          </>
        ) : phase === 'recording' ? (
          <>
            <span className="widget-status-text rec">Gravando</span>
            <span className="widget-timer">{formatTime(elapsed)}</span>
          </>
        ) : (
          <span className="widget-status-text idle">Gravar</span>
        )}
      </div>
    </div>
  );
};

