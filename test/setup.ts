import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock window.redbusAPI
(global as any).window = global;
(global as any).window.redbusAPI = {
  getProviderConfigs: vi.fn(),
  saveProviderConfigs: vi.fn(),
  runWorkerTest: vi.fn(),
  createSpecFromPrompt: vi.fn(),
  showBrowserView: vi.fn(),
  hideBrowserView: vi.fn(),
  resumeViewExtraction: vi.fn(),
  onAuthRequired: vi.fn(),
  getRecentActivityLogs: vi.fn().mockResolvedValue({ status: 'OK', data: [] }),
  clearActivityLogs: vi.fn().mockResolvedValue({ status: 'OK' }),
  onActivityLogEntry: vi.fn(),
  // TitleBar / sensor toggles
  getSensorStatuses: vi.fn().mockResolvedValue({ status: 'OK', data: [] }),
  toggleSensor: vi.fn().mockResolvedValue({ status: 'OK' }),
  getAppSetting: vi.fn().mockResolvedValue({ status: 'OK', data: null }),
  getProactivityLevel: vi.fn().mockResolvedValue({ status: 'OK', data: 'MEDIUM' }),
  setProactivityLevel: vi.fn().mockResolvedValue({ status: 'OK' }),
  getWindowPlatform: vi.fn().mockResolvedValue({ status: 'OK', data: 'darwin' }),
  isWindowMaximized: vi.fn().mockResolvedValue({ status: 'OK', data: false }),
  minimizeWindow: vi.fn().mockResolvedValue({ status: 'OK' }),
  maximizeWindow: vi.fn().mockResolvedValue({ status: 'OK' }),
  closeWindow: vi.fn().mockResolvedValue({ status: 'OK' }),
  openWidget: vi.fn().mockResolvedValue({ status: 'OK' }),
  closeWidget: vi.fn().mockResolvedValue({ status: 'OK' }),
};
