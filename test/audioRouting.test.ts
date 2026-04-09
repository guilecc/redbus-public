/**
 * Tests for AudioRoutingService — system audio capture via RedBus Audio Bridge
 *
 * Tests the public interface using dependency injection for the helper executor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron before import
vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/mock/app',
    getPath: (name: string) => `/mock/${name}`,
  },
  BrowserWindow: class { },
}));

// Mock fs.existsSync to find the helper binary
vi.mock('fs', () => ({
  default: { existsSync: () => true },
  existsSync: () => true,
}));

// Mock child_process — execFileSync + spawn
const mockExecFileSync = vi.fn();
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  default: { execFileSync: (...args: any[]) => mockExecFileSync(...args) },
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
  spawn: (...args: any[]) => mockSpawn(...args),
}));

import {
  listAudioDevices,
  isDriverInstalled,
  getRedBusDevice,
  getDefaultOutputUID,
  isRoutingActive,
  getRedBusDeviceUID,
  startSystemAudioCapture,
  stopSystemAudioCapture,
  cleanupAudioRouting,
  reactivateRouting,
} from '../electron/services/audioRoutingService';

const MOCK_DEVICES = [
  { id: 100, name: 'MacBook Air Speakers', uid: 'BuiltInSpeakerDevice', hasInput: false, hasOutput: true },
  { id: 107, name: 'MacBook Air Microphone', uid: 'BuiltInMicrophoneDevice', hasInput: true, hasOutput: false },
  { id: 112, name: 'RedBusAudio 2ch', uid: 'RedBusAudio2ch_UID', hasInput: true, hasOutput: true },
];

describe('AudioRoutingService', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    // Reset internal routing state
    mockExecFileSync.mockReturnValue('OK');
    try { stopSystemAudioCapture(); } catch { /* noop */ }
  });

  describe('listAudioDevices', () => {
    it('should parse JSON output from helper', () => {
      mockExecFileSync.mockReturnValue(JSON.stringify(MOCK_DEVICES));
      const devices = listAudioDevices();
      expect(devices).toHaveLength(3);
      expect(devices[2].name).toBe('RedBusAudio 2ch');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        expect.stringContaining('redbus-audio-helper'),
        ['list-devices'],
        expect.any(Object)
      );
    });
  });

  describe('isDriverInstalled', () => {
    it('should return true when RedBusAudio device exists', () => {
      mockExecFileSync.mockReturnValue(JSON.stringify(MOCK_DEVICES));
      expect(isDriverInstalled()).toBe(true);
    });

    it('should return false when no RedBusAudio device', () => {
      mockExecFileSync.mockReturnValue(JSON.stringify(MOCK_DEVICES.slice(0, 2)));
      expect(isDriverInstalled()).toBe(false);
    });

    it('should return false when helper throws', () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
      expect(isDriverInstalled()).toBe(false);
    });
  });

  describe('getRedBusDevice', () => {
    it('should return the RedBusAudio device', () => {
      mockExecFileSync.mockReturnValue(JSON.stringify(MOCK_DEVICES));
      const dev = getRedBusDevice();
      expect(dev).not.toBeNull();
      expect(dev!.uid).toBe('RedBusAudio2ch_UID');
      expect(dev!.hasInput).toBe(true);
    });

    it('should return null when not installed', () => {
      mockExecFileSync.mockReturnValue(JSON.stringify(MOCK_DEVICES.slice(0, 2)));
      expect(getRedBusDevice()).toBeNull();
    });
  });

  describe('getDefaultOutputUID', () => {
    it('should return the UID from helper', () => {
      mockExecFileSync.mockReturnValue('BuiltInSpeakerDevice');
      expect(getDefaultOutputUID()).toBe('BuiltInSpeakerDevice');
    });
  });

  describe('startSystemAudioCapture / stopSystemAudioCapture', () => {
    it('should create aggregate and return session', () => {
      const mockCheckResult = {
        driverInstalled: true,
        redbusUID: 'RedBusAudio2ch_UID',
        redbusName: 'RedBusAudio 2ch',
        found: true,
      };
      const mockAggResult = {
        aggregateID: 999,
        aggregateUID: 'com.redbus.aggregate.123',
        redbusUID: 'RedBusAudio2ch_UID',
        defaultChanged: true,
        outputUID: 'BuiltInSpeakerDevice',
      };

      mockExecFileSync
        .mockReturnValueOnce(JSON.stringify(mockCheckResult))  // check-multi-output (getDriverStatus)
        .mockReturnValueOnce(JSON.stringify(MOCK_DEVICES))     // list-devices (getDriverStatus internal)
        .mockReturnValueOnce('BuiltInSpeakerDevice')           // get-default-output
        .mockReturnValueOnce(JSON.stringify(MOCK_DEVICES))     // list-devices (to check current device)
        .mockReturnValueOnce(JSON.stringify(mockAggResult));   // create-aggregate

      const session = startSystemAudioCapture();
      expect(session.redbusUID).toBe('RedBusAudio2ch_UID');
      expect(session.aggregateID).toBe(999);
      expect(session.defaultChanged).toBe(true);
    });

    it('should return needsSetup when driver not installed', () => {
      const mockCheckResult = { driverInstalled: false, found: false };

      mockExecFileSync
        .mockReturnValueOnce(JSON.stringify(mockCheckResult))  // check-multi-output
        .mockReturnValueOnce(JSON.stringify(MOCK_DEVICES.slice(0, 2)));  // list-devices

      const session = startSystemAudioCapture();
      expect(session.needsSetup).toBe(true);
      expect(session.aggregateID).toBe(0);
    });

    it('stopSystemAudioCapture should destroy aggregate and restore output', () => {
      // First create a session
      const mockAggResult = {
        aggregateID: 999,
        aggregateUID: 'com.redbus.aggregate.123',
        redbusUID: 'RedBusAudio2ch_UID',
        defaultChanged: true,
        outputUID: 'BuiltInSpeakerDevice',
      };
      const mockCheckResult = { driverInstalled: true, redbusUID: 'RedBusAudio2ch_UID', found: true };

      mockExecFileSync
        .mockReturnValueOnce(JSON.stringify(mockCheckResult))
        .mockReturnValueOnce(JSON.stringify(MOCK_DEVICES))
        .mockReturnValueOnce('BuiltInSpeakerDevice')
        .mockReturnValueOnce(JSON.stringify(MOCK_DEVICES))
        .mockReturnValueOnce(JSON.stringify(mockAggResult));

      startSystemAudioCapture();
      expect(isRoutingActive()).toBe(true);

      // Now stop
      mockExecFileSync.mockReset();
      mockExecFileSync.mockReturnValue('OK');
      stopSystemAudioCapture();
      expect(isRoutingActive()).toBe(false);

      // Should have called set-default-output and destroy-aggregate
      const calls = mockExecFileSync.mock.calls;
      expect(calls.some((c: any[]) => c[1]?.includes('set-default-output'))).toBe(true);
      expect(calls.some((c: any[]) => c[1]?.includes('destroy-aggregate'))).toBe(true);
    });

    it('cleanupAudioRouting should not throw', () => {
      mockExecFileSync.mockReturnValue('OK');
      expect(() => cleanupAudioRouting()).not.toThrow();
    });
  });

  describe('reactivateRouting', () => {
    it('should return error when no active session', () => {
      const result = reactivateRouting();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active');
    });
  });
});

