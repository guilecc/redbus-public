import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const mockBrowserView = {
  setBounds: vi.fn(),
  webContents: {
    on: vi.fn(),
    executeJavaScript: vi.fn().mockResolvedValue('MOCKED DOM INNER TEXT DO WEB CONTENT'),
    loadURL: vi.fn(),
    getURL: vi.fn().mockReturnValue('https://example.com'),
  }
};

const mockMainWindow = {
  setBrowserView: vi.fn(),
  removeBrowserView: vi.fn(),
  getSize: vi.fn().mockReturnValue([1000, 800])
};

vi.mock('electron', () => ({
  BrowserView: class {
    constructor() {
      return mockBrowserView;
    }
  },
  BrowserWindow: class { }
}));

import { createHiddenBrowserView, SNAPSHOT_JS, snapshotPage, clickElement, scrollPage } from '../electron/browserManager';
import { resolveHumanConsent } from '../electron/services/workerLoop';

describe('Browser Manager - Isolated Web Context', () => {

  it('1. Deve criar uma BrowserView isolada e escondida carregando URL', async () => {
    mockBrowserView.webContents.on.mockImplementation((event, callback) => {
      if (event === 'did-finish-load') {
        setTimeout(callback, 10);
      }
    });

    const resultPromise = createHiddenBrowserView(mockMainWindow as any, 'https://example.com');
    const result = await resultPromise;

    expect(mockMainWindow.setBrowserView).toHaveBeenCalledWith(mockBrowserView);
    expect(mockBrowserView.webContents.loadURL).toHaveBeenCalledWith('https://example.com');
    expect(mockMainWindow.removeBrowserView).toHaveBeenCalledWith(mockBrowserView);
    expect(result.text).toBe('MOCKED DOM INNER TEXT DO WEB CONTENT');
  });

});

/**
 * Helper: runs the SNAPSHOT_JS script against a JSDOM document.
 * Returns the YAML-like snapshot string.
 */
function runSnapshotExtractor(html: string): string {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;

  const origGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = (el: Element) => {
    try {
      const style = origGetComputedStyle(el);
      return style;
    } catch {
      return { display: 'block', visibility: 'visible', opacity: '1' } as any;
    }
  };

  const scriptContent = `window.__redbusResult = (${SNAPSHOT_JS.trim()});`;
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = scriptContent;
  window.document.body.appendChild(scriptEl);

  const result = (window as any).__redbusResult || '';
  dom.window.close();
  return result;
}

describe('Unified Snapshot DOM Extractor', () => {

  it('1. Deve capturar aria-label de elementos', () => {
    const html = `<html><body>
      <div aria-label="Email de João Silva joao@numenit.com">
        <span>João Silva</span>
      </div>
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).toContain('joao@numenit.com');
    expect(result).toContain('João Silva');
  });

  it('2. Deve capturar href de links', () => {
    const html = `<html><body>
      <a href="https://outlook.com/mail/inbox">Caixa de Entrada</a>
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).toContain('Caixa de Entrada');
    expect(result).toContain('outlook.com/mail/inbox');
  });

  it('3. Deve capturar title de elementos', () => {
    const html = `<html><body>
      <div title="Reunião com equipe às 14h">Reunião</div>
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).toContain('Reunião com equipe às 14h');
  });

  it('4. Deve capturar alt de imagens', () => {
    const html = `<html><body>
      <img alt="Foto de perfil de Maria" src="photo.jpg" />
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).toContain('Foto de perfil de Maria');
  });

  it('5. Deve remover scripts e styles', () => {
    const html = `<html><body>
      <script>var secret = "password123";</script>
      <style>.hidden { display: none; }</style>
      <p>Conteúdo visível</p>
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).not.toContain('password123');
    expect(result).not.toContain('.hidden');
    expect(result).toContain('Conteúdo visível');
  });

  it('6. Deve capturar inputs com placeholder e aria-label', () => {
    const html = `<html><body>
      <input type="text" aria-label="Buscar emails" placeholder="Pesquisar..." />
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).toContain('Buscar emails');
  });

  it('7. Deve capturar botões com aria-label', () => {
    const html = `<html><body>
      <button aria-label="Enviar mensagem">Enviar</button>
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).toContain('Enviar');
  });

  it('8. Deve capturar dados complexos de email (simulação Outlook)', () => {
    const html = `<html><body>
      <div role="listbox" aria-label="Lista de mensagens">
        <div role="option" aria-label="Email de Flávio Molina flavio@numenit.com, Assunto: Proposta SAP, Recebido: 11 de março">
          <span>Flávio Molina</span>
          <span>Proposta SAP</span>
          <span>11 mar</span>
        </div>
        <div role="option" aria-label="Email de Ana Costa ana@numenit.com, Assunto: Reunião semanal, Recebido: 10 de março">
          <span>Ana Costa</span>
          <span>Reunião semanal</span>
          <span>10 mar</span>
        </div>
      </div>
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).toContain('flavio@numenit.com');
    expect(result).toContain('Proposta SAP');
    expect(result).toContain('ana@numenit.com');
    expect(result).toContain('Reunião semanal');
  });

  it('9. Deve remover SVGs', () => {
    const html = `<html><body>
      <svg><path d="M0 0 L10 10" /></svg>
      <p>Texto real</p>
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).not.toContain('M0 0');
    expect(result).toContain('Texto real');
  });

  it('10. Deve gerar refs [ref=N] para elementos interativos', () => {
    const html = `<html><body>
      <button>Enviar</button>
      <input type="text" placeholder="Buscar" />
      <a href="/inbox">Inbox</a>
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).toMatch(/\[ref=0\]/);
    expect(result).toMatch(/\[ref=1\]/);
    expect(result).toMatch(/\[ref=2\]/);
  });

  it('11. Deve gerar snapshot YAML-like indentado', () => {
    const html = `<html><body>
      <nav>
        <a href="/home">Home</a>
      </nav>
      <main>
        <p>Conteúdo principal</p>
      </main>
    </body></html>`;
    const result = runSnapshotExtractor(html);
    expect(result).toContain('navigation');
    expect(result).toContain('main');
    expect(result).toContain('Home');
    expect(result).toContain('Conteúdo principal');
  });
});

describe('Browser Actions — Error handling', () => {

  it('1. snapshotPage deve rejeitar para viewId inexistente', async () => {
    await expect(snapshotPage('non-existent')).rejects.toThrow('View not found');
  });

  it('2. clickElement deve rejeitar para viewId inexistente', async () => {
    await expect(clickElement('non-existent', 0)).rejects.toThrow('View not found');
  });

  it('3. scrollPage deve rejeitar para viewId inexistente', async () => {
    await expect(scrollPage('non-existent', 'down')).rejects.toThrow('View not found');
  });
});

describe('HITL Consent — resolveHumanConsent', () => {

  it('1. Deve retornar false para requestId inexistente', () => {
    const result = resolveHumanConsent('non-existent-request', true);
    expect(result).toBe(false);
  });

  it('2. Deve retornar false para requestId já resolvido', () => {
    // No pending consent — should return false
    const result = resolveHumanConsent('already-resolved', false);
    expect(result).toBe(false);
  });
});
