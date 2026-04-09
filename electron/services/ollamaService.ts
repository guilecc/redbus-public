import { BrowserWindow } from 'electron';

export async function checkOllamaStatus(ollamaUrl: string = 'http://localhost:11434'): Promise<boolean> {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`);
    return response.ok;
  } catch (e) {
    return false;
  }
}

export async function listInstalledModels(ollamaUrl: string = 'http://localhost:11434'): Promise<any[]> {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.models || [];
  } catch (e) {
    return [];
  }
}

export async function pullModel(
  ollamaUrl: string = 'http://localhost:11434',
  modelTag: string,
  mainWindow: BrowserWindow | null
): Promise<void> {
  if (!mainWindow) return;

  try {
    const response = await fetch(`${ollamaUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelTag })
    });

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.trim() !== '');

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          mainWindow.webContents.send('ollama:pull-progress', {
            model: modelTag,
            status: parsed.status,
            completed: parsed.completed,
            total: parsed.total,
          });
        } catch (e) {
          // Ignore parsing errors for incomplete chunks
        }
      }
    }
  } catch (e: any) {
    mainWindow.webContents.send('ollama:pull-progress', {
      model: modelTag,
      status: 'error',
      error: e.message || String(e),
    });
  }
}
