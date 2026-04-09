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
};
