import { BrowserView, BrowserWindow, session } from 'electron';
import { v4 as uuidv4 } from 'uuid';

const activeViews = new Map<string, BrowserView>();
const pendingExtractions = new Map<string, (val?: any) => void>();

// Auth gate: stores Promise resolvers keyed by viewId.
// When auth is detected, the resolve is stored here.
// It is ONLY called when the user clicks "já loguei" via IPC browser:resume-auth.
const authResolvers = new Map<string, { resolve: (value?: any) => void; mainWindow: BrowserWindow }>();

// ── Persistent session: cookies/auth survive across views and app restarts ──
const PERSIST_PARTITION = 'persist:redbus';

function getSessionConfig() {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    partition: PERSIST_PARTITION,
  };
}

// ── Auth detection patterns ──
const AUTH_URL_PATTERNS = [
  'login.microsoftonline.com',
  'login.live.com',
  'accounts.google.com',
  'github.com/login',
  'github.com/session',
  'auth0.com',
  'okta.com',
  '/auth',
  '/signin',
  '/login',
];

function isAuthUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return AUTH_URL_PATTERNS.some(pattern => lower.includes(pattern));
}

export async function createHiddenBrowserView(mainWindow: BrowserWindow, targetUrl: string): Promise<{ text: string }> {
  return new Promise((resolve, reject) => {
    try {
      const viewId = uuidv4();
      const view = new BrowserView({
        webPreferences: getSessionConfig()
      });
      activeViews.set(viewId, view);
      mainWindow.setBrowserView(view);
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

      view.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
        mainWindow.removeBrowserView(view);
        activeViews.delete(viewId);
        reject(new Error(`Failed to load ${targetUrl}: ${errorDescription}`));
      });

      view.webContents.on('did-navigate', (event, url) => {
        if (isAuthUrl(url)) {
          mainWindow.webContents.send('auth-required', { viewId, url });
        }
      });

      view.webContents.on('did-finish-load', async () => {
        try {
          const result = await view.webContents.executeJavaScript(`
            (() => document.body.innerText || document.documentElement.innerText)()
          `);

          const currentUrl = view.webContents.getURL();
          if (isAuthUrl(currentUrl)) {
            pendingExtractions.set(viewId, async () => {
              const updatedResult = await view.webContents.executeJavaScript(`
                (() => document.body.innerText || document.documentElement.innerText)()
              `);
              mainWindow.removeBrowserView(view);
              activeViews.delete(viewId);
              resolve({ text: updatedResult as string });
            });
            return;
          }

          mainWindow.removeBrowserView(view);
          activeViews.delete(viewId);
          resolve({ text: result });
        } catch (scriptError) {
          mainWindow.removeBrowserView(view);
          activeViews.delete(viewId);
          reject(scriptError);
        }
      });

      view.webContents.loadURL(targetUrl);
    } catch (err) {
      reject(err);
    }
  });
}

export function showBrowserView(mainWindow: BrowserWindow, viewId: string) {
  const view = activeViews.get(viewId);
  if (!view) return { status: 'ERROR', error: 'View not found' };

  const [width, height] = mainWindow.getSize();
  // Centraliza e expande no centro
  const vw = Math.floor(width * 0.8);
  const vh = Math.floor(height * 0.8);
  const x = Math.floor((width - vw) / 2);
  const y = Math.floor((height - vh) / 2);

  view.setBounds({ x, y, width: vw, height: vh });
  return { status: 'OK' };
}

export function hideBrowserView(mainWindow: BrowserWindow, viewId: string) {
  const view = activeViews.get(viewId);
  if (!view) return { status: 'ERROR', error: 'View not found' };
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  return { status: 'OK' };
}

export function resumeViewExtraction(viewId: string) {
  const resumeFn = pendingExtractions.get(viewId);
  if (resumeFn) {
    resumeFn();
    pendingExtractions.delete(viewId);
    return { status: 'OK' };
  }
  return { status: 'ERROR', error: 'No pending extraction for this view' };
}
/**
 * Create a persistent BrowserView and navigate to the target URL.
 * Auth detection is now handled by the Worker LLM via the request_user_authentication tool.
 * This function simply creates the view, navigates, and waits for the page to finish loading.
 * Uses persist:redbus session so cookies survive across views and app restarts.
 */
export async function createPersistentBrowserView(mainWindow: BrowserWindow, targetUrl: string): Promise<string> {
  const viewId = uuidv4();
  const view = new BrowserView({
    webPreferences: getSessionConfig()
  });
  activeViews.set(viewId, view);
  mainWindow.setBrowserView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

  // Block popups — redirect them to the same view (login flows often use window.open)
  view.webContents.setWindowOpenHandler(({ url }) => {
    console.log(`[BrowserManager] Popup blocked, navigating in-view: ${url}`);
    view.webContents.loadURL(url);
    return { action: 'deny' };
  });

  let finalUrl = targetUrl;
  if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
    finalUrl = 'https://' + finalUrl;
  }

  return new Promise((resolve, reject) => {
    let resolved = false;

    view.webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3 && errorCode !== -501 && !resolved) {
        mainWindow.removeBrowserView(view);
        activeViews.delete(viewId);
        reject(new Error(`Failed to load ${finalUrl}: ${errorDescription} (${errorCode})`));
      }
    });

    view.webContents.on('did-finish-load', () => {
      if (resolved) return;
      resolved = true;
      const currentUrl = view.webContents.getURL();
      console.log(`[BrowserManager] createPersistentBrowserView: page loaded at ${currentUrl}`);
      // Give SPA a moment to initialize JS framework
      setTimeout(() => resolve(viewId), 1500);
    });

    view.webContents.loadURL(finalUrl).catch(err => {
      mainWindow.removeBrowserView(view);
      activeViews.delete(viewId);
      reject(new Error(`Failed to load ${finalUrl}: ${err}`));
    });
  });
}

/**
 * Navigate an existing BrowserView to a new URL.
 * Auth detection is handled by the Worker LLM via request_user_authentication tool.
 * Reuses the same view (and session/cookies) — critical for post-auth navigation.
 */
export async function navigateView(mainWindow: BrowserWindow, viewId: string, targetUrl: string): Promise<void> {
  const view = activeViews.get(viewId);
  if (!view) throw new Error('View not found');

  let finalUrl = targetUrl;
  if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
    finalUrl = 'https://' + finalUrl;
  }

  return new Promise((resolve, reject) => {
    let resolved = false;

    view.webContents.on('did-finish-load', () => {
      if (resolved) return;
      resolved = true;
      const currentUrl = view.webContents.getURL();
      console.log(`[BrowserManager] navigateView: page loaded at ${currentUrl}`);
      setTimeout(() => resolve(), 1500);
    });

    view.webContents.loadURL(finalUrl).catch(err => {
      reject(new Error(`Failed to load ${finalUrl}: ${err}`));
    });
  });
}


/**
 * Show a BrowserView to the user for authentication (called by Worker tool).
 * Displays the floating panel and sends 'auth-required' to the frontend.
 * Returns a Promise that resolves when the user clicks "já loguei" (via resolveAuth).
 */
export function showViewForUserAuth(mainWindow: BrowserWindow, viewId: string): Promise<void> {
  const view = activeViews.get(viewId);
  if (!view) return Promise.reject(new Error('View not found'));

  if (authResolvers.has(viewId)) {
    console.log(`[BrowserManager] showViewForUserAuth: auth already pending for ${viewId}`);
    return new Promise((resolve) => {
      const existing = authResolvers.get(viewId)!;
      const origResolve = existing.resolve;
      existing.resolve = (val: any) => { origResolve(val); resolve(); };
    });
  }

  const currentUrl = view.webContents.getURL();
  console.log(`[BrowserManager] ★ showViewForUserAuth: Showing login panel for ${currentUrl}`);

  const BORDER = 3; // px for red border frame
  const BUTTON_AREA = 52; // px reserved below for "já loguei" button

  const [width, height] = mainWindow.getSize();
  const frameW = Math.min(420, Math.floor(width * 0.45));
  const frameH = Math.floor(height * 0.70);
  const frameX = Math.floor((width - frameW) / 2);
  const frameY = Math.floor((height - frameH - BUTTON_AREA) / 2);

  // BrowserView sits inset by BORDER inside the frame
  view.setBounds({
    x: frameX + BORDER,
    y: frameY + BORDER,
    width: frameW - BORDER * 2,
    height: frameH - BORDER * 2,
  });
  view.webContents.setZoomFactor(0.85);

  // Inject subtle opacity into the BrowserView content
  view.webContents.insertCSS('html { opacity: 0.95 !important; }').catch(() => { });

  // Send bounds so React can draw the border frame and button
  const frameBounds = { x: frameX, y: frameY, width: frameW, height: frameH };
  mainWindow.webContents.send('auth-required', { viewId, url: currentUrl, bounds: frameBounds });

  return new Promise((resolve) => {
    authResolvers.set(viewId, { resolve: () => resolve(), mainWindow });
  });
}

/**
 * Resolve a pending auth gate for a viewId.
 * Called by IPC handler browser:resume-auth when user clicks "já loguei".
 * Hides the BrowserView and resolves the pending Promise so the worker can continue.
 */
export function resolveAuth(viewId: string): boolean {
  const entry = authResolvers.get(viewId);
  if (!entry) {
    console.warn(`[BrowserManager] resolveAuth: no pending auth for viewId=${viewId}`);
    return false;
  }
  const view = activeViews.get(viewId);
  if (view) {
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
  entry.mainWindow.webContents.send('auth-completed', { viewId });
  entry.resolve(viewId);
  authResolvers.delete(viewId);
  console.log(`[BrowserManager] resolveAuth: auth resolved for viewId=${viewId}`);
  return true;
}

/**
 * Injected JS that builds a unified Accessibility Snapshot of the DOM.
 * Inspired by Playwright's ariaSnapshot / OpenClaw's CDP approach.
 *
 * Returns a YAML-like indented tree where:
 * - Each node shows its ARIA role (or tag) + name/label
 * - Interactive elements get a [ref=N] marker for targeting actions
 * - Content text is shown inline
 * - Invisible elements, scripts, styles, SVGs are removed
 *
 * The LLM receives ONE unified view: content + interactive refs together.
 */
export const SNAPSHOT_JS = `
(() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','LINK','META','HEAD']);
  const INTERACTIVE = new Set(['A','BUTTON','INPUT','TEXTAREA','SELECT']);
  const INTERACTIVE_ROLES = new Set(['button','link','searchbox','textbox','menuitem','tab','checkbox','radio','combobox','option','switch']);
  let refCounter = 0;
  const lines = [];

  function isVisible(el) {
    if (el.nodeType !== 1) return true;
    try {
      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    } catch(e) {}
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }

  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === 'A' && el.getAttribute('href')) return 'link';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button') return 'button';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'IMG') return 'img';
    if (tag === 'NAV') return 'navigation';
    if (tag === 'MAIN') return 'main';
    if (tag === 'HEADER') return 'banner';
    if (tag === 'FOOTER') return 'contentinfo';
    if (tag === 'UL' || tag === 'OL') return 'list';
    if (tag === 'LI') return 'listitem';
    if (tag === 'TABLE') return 'table';
    if (tag === 'TR') return 'row';
    if (tag === 'TD' || tag === 'TH') return 'cell';
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') return 'heading';
    if (tag === 'SECTION') return 'region';
    return null;
  }

  function getName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const title = el.getAttribute('title');
    if (title) return title;
    const alt = el.getAttribute('alt');
    if (alt) return alt;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const id = el.getAttribute('id');
      if (id) {
        const label = document.querySelector('label[for="' + id + '"]');
        if (label) return (label.textContent || '').trim().substring(0, 80);
      }
      return el.value ? el.value.substring(0, 60) : '';
    }
    return '';
  }

  function isInteractive(el) {
    if (INTERACTIVE.has(el.tagName)) return true;
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.getAttribute('onclick') || el.getAttribute('contenteditable') === 'true') return true;
    if (el.getAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return true;
    return false;
  }

  function walk(node, depth) {
    if (node.nodeType === 3) {
      const t = node.textContent.trim();
      if (t && t.length > 0) {
        const indent = '  '.repeat(depth);
        lines.push(indent + '- text: ' + JSON.stringify(t.substring(0, 200)));
      }
      return;
    }
    if (node.nodeType !== 1) return;
    if (SKIP.has(node.tagName)) return;
    if (!isVisible(node)) return;

    const role = getRole(node);
    const name = getName(node);
    const interactive = isInteractive(node);
    const indent = '  '.repeat(depth);

    // Assign ref to interactive elements
    let ref = '';
    if (interactive) {
      ref = ' [ref=' + refCounter + ']';
      node.setAttribute('data-redbus-id', refCounter.toString());
      refCounter++;
    }

    // Build line
    const displayRole = role || (name ? 'group' : null);
    if (displayRole) {
      const nameStr = name ? ' ' + JSON.stringify(name.substring(0, 150)) : '';
      let extra = '';
      if (displayRole === 'link') {
        const href = node.getAttribute('href');
        if (href && !href.startsWith('javascript:')) extra = ' href=' + JSON.stringify(href.substring(0, 150));
      }
      if ((displayRole === 'textbox' || displayRole === 'searchbox') && node.value) {
        extra = ' value=' + JSON.stringify(node.value.substring(0, 80));
      }

      lines.push(indent + '- ' + displayRole + nameStr + ref + extra);
    }

    // Recurse children (skip if leaf interactive with name already captured)
    const skipChildren = (node.tagName === 'BUTTON' || node.tagName === 'A') && name;
    if (!skipChildren) {
      for (const child of node.childNodes) {
        walk(child, displayRole ? depth + 1 : depth);
      }
    }
  }

  walk(document.body, 0);
  return lines.join('\\n');
})()
`;

/**
 * Take a unified snapshot of the page: content + interactive refs in one YAML-like tree.
 * Waits for SPA content to stabilize using progressive polling.
 */
export async function snapshotPage(viewId: string): Promise<string> {
  const view = activeViews.get(viewId);
  if (!view) throw new Error('View not found');

  // Phase 1: Wait for basic content (>300 chars)
  for (let attempt = 0; attempt < 4; attempt++) {
    const text = await view.webContents.executeJavaScript(SNAPSHOT_JS) as string;
    const len = (text || '').length;
    if (len > 300) {
      console.log(`[BrowserManager] snapshotPage phase 1: got ${len} chars on attempt ${attempt + 1}`);
      break;
    }
    console.log(`[BrowserManager] snapshotPage phase 1: only ${len} chars on attempt ${attempt + 1}, waiting...`);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Phase 2: Wait for content to stabilize
  let previousLen = 0;
  let stableCount = 0;
  let bestText = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    const text = await view.webContents.executeJavaScript(SNAPSHOT_JS) as string;
    const trimmed = (text || '').trim();
    const len = trimmed.length;
    if (len > bestText.length) bestText = trimmed;

    if (len > 300 && Math.abs(len - previousLen) < 100) {
      stableCount++;
      if (stableCount >= 2) {
        console.log(`[BrowserManager] snapshotPage: stabilized at ${len} chars`);
        return bestText;
      }
    } else {
      stableCount = 0;
    }
    previousLen = len;
    await new Promise(r => setTimeout(r, 2500));
  }

  console.warn(`[BrowserManager] snapshotPage: returning ${bestText.length} chars after full polling`);
  return bestText;
}

/**
 * Quick snapshot — no polling, just execute once. Used after actions where
 * we already waited for the DOM to update.
 */
async function quickSnapshot(viewId: string): Promise<string> {
  const view = activeViews.get(viewId);
  if (!view) return '';
  const text = await view.webContents.executeJavaScript(SNAPSHOT_JS) as string;
  return (text || '').trim();
}

// ── Legacy aliases for backward compatibility ──
export const extractText = snapshotPage;
export const observePage = async (viewId: string) => {
  // Return empty array — snapshot is now unified. Worker loop no longer calls this.
  return [];
};

/**
 * Click an element by ref number.
 * Waits 2s for SPA to update, then returns the new snapshot.
 */
export async function clickElement(viewId: string, ref: number): Promise<{ status: string; snapshot: string; error?: string }> {
  const view = activeViews.get(viewId);
  if (!view) throw new Error('View not found');

  const result = await view.webContents.executeJavaScript(`
    (() => {
      const el = document.querySelector('[data-redbus-id="${ref}"]');
      if (!el) return { status: 'ERROR', error: 'Element ref=${ref} not found' };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();
      el.click();
      return { status: 'OK' };
    })()
  `);

  if (result.status !== 'OK') return { ...result, snapshot: '' };

  await new Promise(r => setTimeout(r, 2000));
  const snapshot = await quickSnapshot(viewId);
  return { status: 'OK', snapshot };
}

/**
 * Type text into an element by ref number.
 * If submit=true, also presses Enter after typing.
 * Waits for SPA update, then returns new snapshot.
 */
export async function typeIntoElement(viewId: string, ref: number, text: string, submit: boolean = false): Promise<{ status: string; snapshot: string; error?: string }> {
  const view = activeViews.get(viewId);
  if (!view) throw new Error('View not found');

  const result = await view.webContents.executeJavaScript(`
    ((ref, text, submit) => {
      const el = document.querySelector('[data-redbus-id="' + ref + '"]');
      if (!el) return { status: 'ERROR', error: 'Element ref=' + ref + ' not found' };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();

      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox' || el.getAttribute('role') === 'searchbox') {
        el.textContent = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        return { status: 'ERROR', error: 'Element is not typeable' };
      }

      if (submit) {
        const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keypress', opts));
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
      }
      return { status: 'OK' };
    })(${ref}, ${JSON.stringify(text)}, ${submit})
  `);

  if (result.status !== 'OK') return { ...result, snapshot: '' };

  // Longer wait if submit (page reload/XHR expected)
  await new Promise(r => setTimeout(r, submit ? 4000 : 1500));
  const snapshot = await quickSnapshot(viewId);
  return { status: 'OK', snapshot };
}

/**
 * Press a key on a focused element or the page.
 * Returns new snapshot after a wait.
 */
export async function pressKey(viewId: string, key: string): Promise<{ status: string; snapshot: string }> {
  const view = activeViews.get(viewId);
  if (!view) throw new Error('View not found');

  const keyMap: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
  const keyCode = keyMap[key] || 0;

  await view.webContents.executeJavaScript(`
    (() => {
      const el = document.activeElement || document.body;
      const opts = { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, keyCode: ${keyCode}, which: ${keyCode}, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', opts));
      el.dispatchEvent(new KeyboardEvent('keypress', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
    })()
  `);

  await new Promise(r => setTimeout(r, key === 'Enter' ? 3000 : 1000));
  const snapshot = await quickSnapshot(viewId);
  return { status: 'OK', snapshot };
}

/**
 * Scroll the page up or down by ~2/3 of the viewport.
 * Returns new snapshot after scroll.
 */
export async function scrollPage(viewId: string, direction: 'up' | 'down'): Promise<{ status: string; snapshot: string }> {
  const view = activeViews.get(viewId);
  if (!view) throw new Error('View not found');

  await view.webContents.executeJavaScript(`
    window.scrollBy({ top: ${direction === 'down' ? 'Math.floor(window.innerHeight * 0.66)' : '-Math.floor(window.innerHeight * 0.66)'}, behavior: 'instant' })
  `);

  await new Promise(r => setTimeout(r, 1000));
  const snapshot = await quickSnapshot(viewId);
  return { status: 'OK', snapshot };
}

// Legacy alias
export async function actOnElement(viewId: string, elementId: number, action: string): Promise<{ status: string; error?: string }> {
  if (action === 'click') {
    const r = await clickElement(viewId, elementId);
    return { status: r.status, error: r.error };
  } else if (action.startsWith('type:')) {
    const text = action.replace('type:', '').trim();
    const r = await typeIntoElement(viewId, elementId, text);
    return { status: r.status, error: r.error };
  } else if (action.startsWith('press_key:')) {
    const key = action.replace('press_key:', '').trim();
    const r = await pressKey(viewId, key);
    return { status: r.status };
  }
  return { status: 'ERROR', error: 'Unknown action: ' + action };
}

// Legacy alias
export async function waitForUiState(viewId: string, delayMs: number, _waitForSelector?: string): Promise<{ status: string; elapsed_ms?: number }> {
  await new Promise(r => setTimeout(r, Math.min(delayMs, 10000)));
  return { status: 'OK', elapsed_ms: delayMs };
}

export async function cleanupBrowserView(mainWindow: BrowserWindow, viewId: string) {
  const view = activeViews.get(viewId);
  if (view) {
    mainWindow.removeBrowserView(view);
    activeViews.delete(viewId);
  }
}
