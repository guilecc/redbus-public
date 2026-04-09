import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Use vi.hoisted to declare the mock before imports
const mockIpcMain = vi.hoisted(() => ({
  handle: vi.fn(),
}));

// Vi mock for electron must return mocked objects before the test imports them
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => ''),
  },
  ipcMain: mockIpcMain
}));

import { initializeDatabase } from '../electron/database';
import { setupIpcHandlers } from '../electron/ipcHandlers';

describe('IPC Handlers Communication', () => {
  let db: ReturnType<typeof initializeDatabase>;
  const registeredHandlers: Record<string, (event: any, ...args: any[]) => Promise<any>> = {};

  beforeEach(() => {
    // Inicializamos DB na memória para isolar do disco
    db = initializeDatabase(':memory:');
    
    // interceptamos a injeção do mock de handles pra testá-los
    mockIpcMain.handle.mockImplementation((channel, callback) => {
      registeredHandlers[channel] = callback;
    });

    // Injetamos a instância do DB nos handlers (mainWindow mockada = null)
    setupIpcHandlers(db, null);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
    Object.keys(registeredHandlers).forEach(key => delete registeredHandlers[key]);
  });

  it('1. Deve registrar os canais corretos de IPC', () => {
    expect(mockIpcMain.handle).toHaveBeenCalledWith('settings:get', expect.any(Function));
    expect(mockIpcMain.handle).toHaveBeenCalledWith('settings:save', expect.any(Function));
    expect(mockIpcMain.handle).toHaveBeenCalledWith('settings:save-provider', expect.any(Function));
  });

  it('2. getProviderConfigs deve retornar o default row do SQLite', async () => {
    const handler = registeredHandlers['settings:get'];
    expect(handler).toBeDefined();

    const result = await handler({});
    expect(result.status).toBe('OK');
    expect(result.data).toBeDefined();
    // Checa valores defaults
    expect(result.data.maestroModel).toBe('claude-3-7-sonnet-20250219');
    expect(result.data.id).toBe(1);
  });

  it('3. saveProviderConfigs deve atualizar multiplas chaves ao mesmo tempo via IPC', async () => {
    const handlerSave = registeredHandlers['settings:save'];
    const handlerGet = registeredHandlers['settings:get'];

    const mockPayload = {
      openAiKey: 'sk-proj-test123',
      anthropicKey: 'sk-ant-test123',
      maestroModel: 'o1-preview',
      workerModel: 'gpt-4o-mini'
    };

    // chamamos o IPC simulando o preload
    const saveResponse = await handlerSave({}, mockPayload);
    expect(saveResponse.status).toBe('OK');

    // Testamos a leitura para atestar a gravação
    const getResponse = await handlerGet({});
    expect(getResponse.data.openAiKey).toBe('sk-proj-test123');
    expect(getResponse.data.anthropicKey).toBe('sk-ant-test123');
    expect(getResponse.data.googleKey).toBeNull(); // Not updated, remains default NULL
    expect(getResponse.data.maestroModel).toBe('o1-preview');
    expect(getResponse.data.workerModel).toBe('gpt-4o-mini');
  });

  it('4. saveProviderConfig (unitário) deve atualizar apenas a chave do provider requisitado', async () => {
    const handlerSaveProvider = registeredHandlers['settings:save-provider'];
    const handlerGet = registeredHandlers['settings:get'];

    // Chama o endpoint de "salvar unitário"
    const saveResponse = await handlerSaveProvider({}, 'openai', 'sk-single-test', 'gpt-4o');
    expect(saveResponse.status).toBe('OK');

    // Valida no banco
    const getResponse = await handlerGet({});
    expect(getResponse.data.openAiKey).toBe('sk-single-test');
    expect(getResponse.data.maestroModel).toBe('gpt-4o');
    // Deve manter dados originais/NULL nas outras
    expect(getResponse.data.anthropicKey).toBeNull();
  });

  it('5. get-user-profile deve retornar nulo se não existir perfil', async () => {
    const handlerGetProfile = registeredHandlers['get-user-profile'];
    expect(handlerGetProfile).toBeDefined();

    const response = await handlerGetProfile({});
    expect(response.status).toBe('OK');
    expect(response.data).toBeNull();
  });

  it('6. save-user-profile deve salvar o perfil e get-user-profile deve retorná-lo', async () => {
    const handlerSaveProfile = registeredHandlers['save-user-profile'];
    const handlerGetProfile = registeredHandlers['get-user-profile'];

    const mockProfile = {
      name: 'John Doe',
      role: 'Project Manager',
      preferences: 'Always be polite',
      system_prompt_compiled: 'You are an AI assistant helping John Doe...'
    };

    const saveResponse = await handlerSaveProfile({}, mockProfile);
    expect(saveResponse.status).toBe('OK');

    const getResponse = await handlerGetProfile({});
    expect(getResponse.status).toBe('OK');
    expect(getResponse.data).toBeDefined();
    expect(getResponse.data.name).toBe('John Doe');
    expect(getResponse.data.role).toBe('Project Manager');
    expect(getResponse.data.preferences).toBe('Always be polite');
    expect(getResponse.data.system_prompt_compiled).toBe('You are an AI assistant helping John Doe...');
  });
});
