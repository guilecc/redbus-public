/**
 * AudioRoutingService — Cross-platform system audio capture management.
 *
 * Platform strategies:
 *   macOS:   RedBus Audio Bridge driver + Multi-Output aggregate device
 *   Windows: WASAPI loopback via Electron's setDisplayMediaRequestHandler (native, no driver)
 *   Linux:   PulseAudio/PipeWire monitor sources or pactl loopback module
 *
 * Requires (macOS only): RedBus Audio Bridge driver installed + redbus-audio-helper CLI
 */

import { execFileSync, execSync, ChildProcess, spawn } from 'child_process';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

export type Platform = 'darwin' | 'win32' | 'linux';

/**
 * Get the current platform.
 */
export function getPlatform(): Platform {
  return process.platform as Platform;
}

/**
 * Get platform-specific system audio capture strategy info.
 */
export function getSystemAudioStrategy(): {
  platform: Platform;
  method: 'wasapi-loopback' | 'redbus-aggregate' | 'pulseaudio-monitor' | 'none';
  requiresSetup: boolean;
  nativeCapture: boolean;
  description: string;
} {
  const platform = getPlatform();
  switch (platform) {
    case 'win32':
      return {
        platform, method: 'wasapi-loopback', requiresSetup: false, nativeCapture: true,
        description: 'Windows WASAPI loopback — captura nativa do áudio do sistema, sem driver adicional.',
      };
    case 'darwin':
      return {
        platform, method: 'redbus-aggregate', requiresSetup: true, nativeCapture: false,
        description: 'macOS — requer criação de Multi-Output Device com RedBus Audio Bridge.',
      };
    case 'linux':
      return {
        platform, method: 'pulseaudio-monitor', requiresSetup: false, nativeCapture: true,
        description: 'Linux PulseAudio/PipeWire — captura via monitor source do dispositivo de saída.',
      };
    default:
      return {
        platform, method: 'none', requiresSetup: false, nativeCapture: false,
        description: 'Plataforma não suportada para captura de áudio do sistema.',
      };
  }
}

// ── Linux: PulseAudio/PipeWire helpers ──

/**
 * Find PulseAudio/PipeWire monitor source name for the default output sink.
 * Returns the monitor source name (e.g. "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor")
 * or null if not found.
 */
export function getLinuxMonitorSource(): string | null {
  if (getPlatform() !== 'linux') return null;
  try {
    // Get default sink name
    const defaultSink = execSync('pactl get-default-sink', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (defaultSink) {
      return `${defaultSink}.monitor`;
    }
  } catch { /* pactl not available */ }
  return null;
}

/**
 * Create a PulseAudio loopback module that routes the monitor source to a virtual input.
 * Returns the module index for later unloading, or null on failure.
 */
export function createLinuxLoopback(): { moduleIndex: number; sinkName: string } | null {
  if (getPlatform() !== 'linux') return null;
  try {
    const sinkName = 'redbus_loopback';
    // Create a null sink (virtual output that acts as input)
    const nullIdx = execSync(
      `pactl load-module module-null-sink sink_name=${sinkName} sink_properties=device.description="RedBus_Loopback"`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();
    // Create loopback from default monitor to our null sink's monitor
    const defaultSink = execSync('pactl get-default-sink', { encoding: 'utf-8', timeout: 3000 }).trim();
    execSync(
      `pactl load-module module-loopback source=${defaultSink}.monitor sink=${sinkName} latency_msec=1`,
      { encoding: 'utf-8', timeout: 3000 }
    );
    return { moduleIndex: parseInt(nullIdx, 10), sinkName };
  } catch (e) {
    console.error('[AudioRouting] Linux loopback creation failed:', e);
    return null;
  }
}

/**
 * Remove a PulseAudio loopback module.
 */
export function destroyLinuxLoopback(moduleIndex: number): void {
  if (getPlatform() !== 'linux') return;
  try {
    execSync(`pactl unload-module ${moduleIndex}`, { timeout: 3000 });
  } catch { /* non-fatal */ }
}

const HELPER_NAME = 'redbus-audio-helper';

export interface AudioDevice {
  id: number;
  name: string;
  uid: string;
  hasInput: boolean;
  hasOutput: boolean;
}

export interface DriverStatus {
  driverInstalled: boolean;
  redbusUID: string | null;
  redbusName: string | null;
  needsSetup: boolean;
  setupInstructions: string | null;
}

/**
 * Resolve path to the redbus-audio-helper binary.
 */
function getHelperPath(): string {
  const paths = [
    path.join(app.getAppPath(), 'drivers', 'redbus-audio-bridge', 'helper', HELPER_NAME),
    path.join(app.getAppPath(), 'drivers', 'redbus-audio-bridge', 'build', HELPER_NAME),
    path.join(process.resourcesPath || '', HELPER_NAME),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`${HELPER_NAME} not found. Run: cd drivers/redbus-audio-bridge && ./build.sh`);
}

/**
 * Execute the helper CLI and return stdout.
 */
function execHelper(args: string[]): string {
  const helperPath = getHelperPath();
  try {
    const result = execFileSync(helperPath, args, { encoding: 'utf-8', timeout: 5000 });
    return result.trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString() || '';
    throw new Error(`redbus-audio-helper ${args[0]} failed: ${stderr || err.message}`);
  }
}

/**
 * List all audio devices on the system.
 */
export function listAudioDevices(): AudioDevice[] {
  const json = execHelper(['list-devices']);
  return JSON.parse(json);
}

/**
 * Check if the RedBusAudio driver is installed.
 */
export function isDriverInstalled(): boolean {
  try {
    const devices = listAudioDevices();
    return devices.some(d => d.name.includes('RedBusAudio'));
  } catch {
    return false;
  }
}

/**
 * Get the RedBusAudio device info, or null if not installed.
 */
export function getRedBusDevice(): AudioDevice | null {
  try {
    const devices = listAudioDevices();
    return devices.find(d => d.name.includes('RedBusAudio')) || null;
  } catch {
    return null;
  }
}

/**
 * Get full driver status including setup guidance.
 */
export function getDriverStatus(): DriverStatus {
  try {
    const json = execHelper(['check-multi-output']);
    const data = JSON.parse(json);

    if (!data.driverInstalled) {
      return {
        driverInstalled: false, redbusUID: null, redbusName: null,
        needsSetup: true,
        setupInstructions: 'O driver RedBus Audio Bridge não está instalado. Execute: cd drivers/redbus-audio-bridge && sudo ./scripts/install.sh',
      };
    }

    // Check if there's a Multi-Output device that includes RedBusAudio
    const devices = listAudioDevices();
    const multiOutput = devices.find(d =>
      d.name.includes('Multi-Output') && d.hasOutput && d.uid !== data.redbusUID
    );

    if (!multiOutput) {
      return {
        driverInstalled: true,
        redbusUID: data.redbusUID,
        redbusName: data.redbusName,
        needsSetup: true,
        setupInstructions: 'Abra o "Audio MIDI Setup" (Configuração de Áudio e MIDI), clique no "+" no canto inferior esquerdo, selecione "Criar dispositivo de múltiplas saídas", e marque seus fones/caixas + RedBusAudio 2ch. Depois selecione este dispositivo como saída de som.',
      };
    }

    return {
      driverInstalled: true,
      redbusUID: data.redbusUID,
      redbusName: data.redbusName,
      needsSetup: false,
      setupInstructions: null,
    };
  } catch {
    return {
      driverInstalled: false, redbusUID: null, redbusName: null,
      needsSetup: true, setupInstructions: 'Erro ao verificar driver de áudio.',
    };
  }
}

/**
 * List output devices, excluding RedBusAudio (it's added automatically).
 */
export function listOutputDevices(): AudioDevice[] {
  const devices = listAudioDevices();
  return devices.filter(d => d.hasOutput && !d.name.includes('RedBusAudio'));
}

/**
 * Create aggregate device combining outputUID + RedBusAudio.
 * Does NOT attempt to set as default output (Tahoe blocks it).
 */
export function createAggregate(outputUID: string): { aggregateID: number; aggregateUID: string; aggregateName: string; redbusUID: string } {
  const json = execHelper(['create-aggregate', outputUID]);
  const result = JSON.parse(json);
  return {
    aggregateID: result.aggregateID,
    aggregateUID: result.aggregateUID,
    aggregateName: 'RedBus Multi-Output',
    redbusUID: result.redbusUID,
  };
}

/**
 * Destroy a specific aggregate device by its AudioDeviceID.
 */
export function destroyAggregate(aggregateID: number): void {
  if (aggregateID > 0) {
    execHelper(['destroy-aggregate', String(aggregateID)]);
  }
}

// ── Routing Session State ──

interface RoutingSession {
  aggregateID: number;
  aggregateUID: string;
  originalOutputUID: string;
  redbusUID: string;
}

let activeSession: RoutingSession | null = null;
let watcherProcess: ChildProcess | null = null;
let onOutputChangedCallback: ((uid: string, name: string) => void) | null = null;

export function isRoutingActive(): boolean {
  return activeSession !== null;
}

export function getRedBusDeviceUID(): string | null {
  return getRedBusDevice()?.uid || null;
}

export function getDefaultOutputUID(): string {
  return execHelper(['get-default-output']);
}

/**
 * One-click automated setup: creates aggregate, sets as default, adds RedBusAudio.
 * Uses Tahoe-safe 2-step approach via the Swift helper.
 */
export function startSystemAudioCapture() {
  // If already active, return current session
  if (activeSession) {
    return {
      ...activeSession,
      defaultChanged: true,
      needsSetup: false,
      setupInstructions: null,
    };
  }

  const driverStatus = getDriverStatus();
  if (!driverStatus.driverInstalled) {
    return {
      aggregateID: 0,
      aggregateUID: '',
      originalOutputUID: '',
      redbusUID: '',
      defaultChanged: false,
      needsSetup: true,
      setupInstructions: driverStatus.setupInstructions,
    };
  }

  // Get current default output before we change it
  const originalOutputUID = getDefaultOutputUID();

  // Skip if already using a Multi-Output device (manual setup)
  try {
    const devices = listAudioDevices();
    const currentDevice = devices.find(d => d.uid === originalOutputUID);
    if (currentDevice && (currentDevice.name.includes('Multi-Output') || currentDevice.uid.startsWith('com.redbus.aggregate.'))) {
      return {
        aggregateID: 0,
        aggregateUID: originalOutputUID,
        originalOutputUID,
        redbusUID: driverStatus.redbusUID || '',
        defaultChanged: false,
        needsSetup: false,
        setupInstructions: null,
      };
    }
  } catch { /* continue with automated setup */ }

  // Create aggregate via Tahoe-safe 2-step
  try {
    const json = execHelper(['create-aggregate', originalOutputUID]);
    const result = JSON.parse(json);

    activeSession = {
      aggregateID: result.aggregateID,
      aggregateUID: result.aggregateUID,
      originalOutputUID,
      redbusUID: result.redbusUID,
    };

    return {
      ...activeSession,
      defaultChanged: result.defaultChanged,
      needsSetup: !result.defaultChanged,
      setupInstructions: result.defaultChanged
        ? null
        : 'Dispositivo criado! Clique no ícone 🔊 de som na barra de menu do macOS e selecione "RedBus Multi-Output" como saída.',
      aggregateName: 'RedBus Multi-Output',
    };
  } catch (err: any) {
    console.error('[AudioRouting] Failed to create aggregate:', err.message);
    return {
      aggregateID: 0,
      aggregateUID: '',
      originalOutputUID,
      redbusUID: driverStatus.redbusUID || '',
      defaultChanged: false,
      needsSetup: true,
      setupInstructions: `Falha ao criar dispositivo automático: ${err.message}. Configure manualmente no Audio MIDI Setup.`,
    };
  }
}

/**
 * Stop system audio capture: destroy aggregate and restore original output.
 */
export function stopSystemAudioCapture(): void {
  if (!activeSession) return;

  const { aggregateID, originalOutputUID } = activeSession;
  activeSession = null;

  try {
    // Restore original output first
    if (originalOutputUID) {
      setDefaultOutput(originalOutputUID);
    }
  } catch (e) {
    console.error('[AudioRouting] Failed to restore original output:', e);
  }

  try {
    // Destroy the aggregate
    if (aggregateID > 0) {
      execHelper(['destroy-aggregate', String(aggregateID)]);
    }
  } catch (e) {
    console.error('[AudioRouting] Failed to destroy aggregate:', e);
  }
}

function setDefaultOutput(uid: string): void {
  execHelper(['set-default-output', uid]);
}

/**
 * Cleanup any stale routing on app exit.
 */
export function cleanupAudioRouting(): void {
  stopSystemAudioCapture();
  stopOutputWatcher();
}

// ── Output Watcher (auto-recovery) ──

/**
 * Start watching for default output changes.
 * When the output changes away from our aggregate (e.g. Bluetooth disconnect),
 * the callback fires so the app can re-activate routing.
 */
export function startOutputWatcher(callback: (uid: string, name: string) => void): void {
  if (watcherProcess) return; // already running

  onOutputChangedCallback = callback;
  try {
    const helperPath = getHelperPath();
    watcherProcess = spawn(helperPath, ['watch-output'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let buffer = '';
    watcherProcess.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line in buffer
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.event === 'output-changed' && onOutputChangedCallback) {
            onOutputChangedCallback(event.uid, event.name);
          }
        } catch { /* ignore malformed lines */ }
      }
    });

    watcherProcess.on('exit', () => {
      watcherProcess = null;
    });
  } catch (e) {
    console.error('[AudioRouting] Failed to start output watcher:', e);
  }
}

/**
 * Stop the output watcher.
 */
export function stopOutputWatcher(): void {
  if (watcherProcess) {
    watcherProcess.kill('SIGTERM');
    watcherProcess = null;
  }
  onOutputChangedCallback = null;
}

/**
 * Re-activate routing after output was changed externally.
 * Only works if we have a saved session with the original output UID.
 */
export function reactivateRouting(): { success: boolean; error?: string } {
  if (activeSession) {
    // Session still exists — try to set our aggregate as default again
    try {
      setDefaultOutput(activeSession.aggregateUID);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'No active routing session' };
}

