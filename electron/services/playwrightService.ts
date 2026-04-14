/**
 * PlaywrightService — Headless Chromium for channel data extraction.
 * Reuses Electron session cookies. Runs in Main process.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { session } from 'electron';
import type { ChannelId } from './extractors/types';

let _browser: Browser | null = null;
const _contexts = new Map<ChannelId, BrowserContext>();

const CHANNEL_URLS: Record<ChannelId, string> = {
  outlook: 'https://outlook.office365.com/mail/',
  teams: 'https://teams.cloud.microsoft/',
};
const PARTITION_NAMES: Record<ChannelId, string> = {
  outlook: 'persist:m365', teams: 'persist:m365',
};
const LOGIN_PATTERNS = ['login.microsoftonline.com', 'login.live.com', 'login.microsoft.com'];

function _getChromiumPath(): string {
  const pw = require('playwright-core');
  return pw.chromium.executablePath();
}

async function _ensureBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await chromium.launch({
    headless: true, executablePath: _getChromiumPath(),
    args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  _browser.on('disconnected', () => { _browser = null; _contexts.clear(); });
  return _browser;
}

async function _exportElectronCookies(channelId: ChannelId) {
  const ses = session.fromPartition(PARTITION_NAMES[channelId]);
  const cookies = await ses.cookies.get({});
  return cookies.map(c => ({
    name: c.name, value: c.value, domain: c.domain || '', path: c.path || '/',
    httpOnly: c.httpOnly || false, secure: c.secure || false,
    sameSite: (c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'lax' ? 'Lax' : 'Lax') as 'Strict' | 'Lax' | 'None',
    expires: c.expirationDate || -1,
  }));
}

/**
 * Get or create a BrowserContext for a channel.
 * Reuses existing context. Call _refreshContext to force cookie re-import.
 */
async function _createContext(channelId: ChannelId): Promise<BrowserContext> {
  const existing = _contexts.get(channelId);
  if (existing) return existing;
  return _refreshContext(channelId);
}

/** Force-create a fresh context with latest Electron cookies */
async function _refreshContext(channelId: ChannelId): Promise<BrowserContext> {
  const browser = await _ensureBrowser();
  const old = _contexts.get(channelId);
  if (old) { try { await old.close(); } catch { } }
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }, locale: 'pt-BR',
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const cookies = await _exportElectronCookies(channelId);
  if (cookies.length > 0) await ctx.addCookies(cookies);
  _contexts.set(channelId, ctx);
  console.log(`[Playwright] Created context for ${channelId} (${cookies.length} cookies)`);
  return ctx;
}

export async function checkSessionValid(channelId: ChannelId): Promise<boolean> {
  try {
    // Always refresh context to get latest cookies from Electron
    const ctx = await _refreshContext(channelId);
    const page = await ctx.newPage();
    const url = CHANNEL_URLS[channelId];
    console.log(`[Playwright] checkSession ${channelId}: loading ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Wait for SPA redirects to settle (Outlook does client-side redirects)
    await page.waitForTimeout(4000);

    const finalUrl = page.url();
    console.log(`[Playwright] checkSession ${channelId}: final URL = ${finalUrl}`);

    // Check URL first
    const matchedLoginPattern = LOGIN_PATTERNS.find(p => finalUrl.includes(p));
    if (matchedLoginPattern) {
      console.log(`[Playwright] checkSession ${channelId}: ❌ on login page (matches pattern: ${matchedLoginPattern})`);
      await page.close();
      return false;
    }

    // Also check page content — look for signs of a logged-in state
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');
    await page.close();

    // If the page shows "browser not supported" or is mostly empty, session might be invalid
    const loginIndicators = ['sign in', 'entrar', 'iniciar sessão', 'password', 'senha', 'versão do seu navegador não'];
    const isLoginContent = loginIndicators.some(t => bodyText.toLowerCase().includes(t));

    console.log(`[Playwright] checkSession ${channelId}: content snapshot (first 100 chars): ${bodyText.substring(0, 100).replace(/\n/g, ' ')}`);

    if (isLoginContent && bodyText.length < 500) {
      console.log(`[Playwright] checkSession ${channelId}: ❌ login/error content detected`);
      return false;
    }

    console.log(`[Playwright] checkSession ${channelId}: ✅ valid (${bodyText.length} chars of content)`);
    return true;
  } catch (err) {
    console.warn(`[Playwright] checkSession ${channelId}: error:`, err);
    return false;
  }
}

export async function shutdownPlaywright(): Promise<void> {
  await browseCloseAll();
  for (const [, ctx] of _contexts) { try { await ctx.close(); } catch { } }
  _contexts.clear();
  if (_browser) { try { await _browser.close(); } catch { } _browser = null; }
}

export async function suspendPlaywright(): Promise<void> {
  for (const [, ctx] of _contexts) { try { await ctx.close(); } catch { } }
  _contexts.clear();
}

export function getChannelUrl(channelId: ChannelId): string { return CHANNEL_URLS[channelId]; }
export function getPartitionName(channelId: ChannelId): string { return PARTITION_NAMES[channelId]; }

/* ═══════════════════════════════════════════════════════════════
   Intelligent Browser — Aria Snapshot + Playwright Locators
   Based on OpenClaw's approach: ariaSnapshot() → ref map → locator.click()
   ═══════════════════════════════════════════════════════════════ */

/** Session state: page + ref map for locator resolution */
type BrowseSession = {
  page: Page;
  refs: Map<string, { role: string; name?: string; nth: number }>;
};

const _sessions = new Map<string, BrowseSession>();
let _browsingContext: BrowserContext | null = null;

async function _ensureBrowsingContext(): Promise<BrowserContext> {
  if (_browsingContext) return _browsingContext;
  const browser = await _ensureBrowser();
  _browsingContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }, locale: 'pt-BR',
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return _browsingContext;
}

/**
 * Open a page and navigate to a URL.
 */
export async function browseOpen(url: string, sessionId?: string): Promise<{ sessionId: string; title: string; url: string }> {
  const id = sessionId || `browse_${Date.now()}`;

  // For inbox sessions, use channel context (with cookies)
  let ctx: BrowserContext;
  if (id.startsWith('inbox_outlook')) {
    ctx = await _createContext('outlook');
  } else if (id.startsWith('inbox_teams')) {
    ctx = await _createContext('teams');
  } else {
    ctx = await _ensureBrowsingContext();
  }

  const existing = _sessions.get(id);
  if (existing) { try { await existing.page.close(); } catch { } }

  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // SPAs need extra time to render — especially Outlook and Teams
  const isInbox = id.startsWith('inbox_');
  const waitMs = isInbox ? 8000 : 3000;
  console.log(`[Playwright] browseOpen: waiting ${waitMs}ms for SPA render...`);
  await page.waitForTimeout(waitMs);
  _sessions.set(id, { page, refs: new Map() });

  return { sessionId: id, title: await page.title(), url: page.url() };
}

/**
 * Take an accessibility snapshot of the page using Playwright's ariaSnapshot().
 * Returns a structured tree with [ref=eN] markers for interactive elements.
 * The LLM uses these refs to click/type/interact.
 */
export async function browseSnapshot(sessionId: string): Promise<string> {
  const s = _sessions.get(sessionId);
  if (!s) return '[ERROR] No page open for this session';

  try {
    // Use Playwright's built-in aria snapshot
    const ariaTree = await s.page.locator(':root').ariaSnapshot({ timeout: 10000 });

    // Parse the aria tree and assign refs to interactive elements
    const { snapshot, refs } = _buildRefSnapshot(ariaTree);
    s.refs = refs;

    const header = `Page: ${await s.page.title()}\nURL: ${s.page.url()}\n---\n`;
    const result = header + snapshot;

    console.log(`[Playwright] Snapshot: ${result.length} chars, ${refs.size} refs`);
    return result.substring(0, 25000);
  } catch (err) {
    // Fallback: use innerText if ariaSnapshot fails
    console.warn(`[Playwright] ariaSnapshot failed, using fallback:`, err);
    const text = await s.page.evaluate(() => document.body?.innerText?.substring(0, 15000) || '');
    return `Page: ${await s.page.title()}\nURL: ${s.page.url()}\n---\n${text}`;
  }
}

/** Interactive roles that get a [ref=eN] marker */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'treeitem',
]);

/**
 * Parse Playwright ariaSnapshot output and add [ref=eN] to interactive elements.
 * Returns the annotated snapshot + a ref→locator map.
 */
function _buildRefSnapshot(ariaTree: string): { snapshot: string; refs: Map<string, { role: string; name?: string; nth: number }> } {
  const lines = ariaTree.split('\n');
  const refs = new Map<string, { role: string; name?: string; nth: number }>();
  const roleCounts = new Map<string, number>(); // track role+name occurrences for nth
  let counter = 0;
  const result: string[] = [];

  for (const line of lines) {
    // Match aria snapshot lines: "  - role "name" ..."
    const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
    if (!match) {
      result.push(line);
      continue;
    }

    const [, prefix, roleRaw, name, suffix] = match;
    const role = roleRaw.toLowerCase();

    if (INTERACTIVE_ROLES.has(role)) {
      counter++;
      const ref = `e${counter}`;
      const key = `${role}:${name || ''}`;
      const nth = roleCounts.get(key) || 0;
      roleCounts.set(key, nth + 1);

      refs.set(ref, { role, name, nth });
      result.push(`${prefix}${roleRaw}${name ? ` "${name}"` : ''} [ref=${ref}]${suffix}`);
    } else {
      result.push(line);
    }
  }

  return { snapshot: result.join('\n'), refs };
}

/**
 * Resolve a ref (e.g. "e5") to a Playwright Locator using getByRole().
 */
function _refToLocator(s: BrowseSession, ref: string) {
  const data = s.refs.get(ref);
  if (!data) throw new Error(`Unknown ref "${ref}". Take a new snapshot first.`);

  const opts: any = {};
  if (data.name) opts.name = data.name;
  if (data.name) opts.exact = true;

  return s.page.getByRole(data.role as any, opts).nth(data.nth);
}

/**
 * Click an element by ref (e.g. "e5").
 * Uses Playwright's native click with auto-wait and scroll-into-view.
 */
export async function browseClick(sessionId: string, ref: string | number): Promise<string> {
  const s = _sessions.get(sessionId);
  if (!s) return '[ERROR] No page open';

  const refStr = typeof ref === 'number' ? `e${ref}` : ref;
  try {
    const locator = _refToLocator(s, refStr);
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => { });
    await locator.click({ timeout: 8000 });
    await s.page.waitForTimeout(1500);
    const data = s.refs.get(refStr);
    return `Clicked ${refStr} (${data?.role} "${data?.name || ''}")`;
  } catch (err) {
    return `[ERROR] Click ${refStr} failed: ${err}`;
  }
}

/**
 * Type text into an element by ref.
 * Uses Playwright's native fill() with fallback to keyboard.type().
 */
export async function browseType(sessionId: string, text: string, ref?: string | number): Promise<string> {
  const s = _sessions.get(sessionId);
  if (!s) return '[ERROR] No page open';

  try {
    if (ref !== undefined) {
      const refStr = typeof ref === 'number' ? `e${ref}` : ref;
      const locator = _refToLocator(s, refStr);
      try {
        await locator.fill(text, { timeout: 5000 });
      } catch {
        // Fallback: click + keyboard type (for contenteditable, etc.)
        await locator.click({ timeout: 5000 });
        await s.page.keyboard.type(text, { delay: 30 });
      }
    } else {
      await s.page.keyboard.type(text, { delay: 30 });
    }
    return `Typed "${text.substring(0, 50)}"`;
  } catch (err) {
    return `[ERROR] Type failed: ${err}`;
  }
}

/**
 * Press a keyboard key.
 */
export async function browsePressKey(sessionId: string, key: string): Promise<string> {
  const s = _sessions.get(sessionId);
  if (!s) return '[ERROR] No page open';
  try {
    await s.page.keyboard.press(key);
    await s.page.waitForTimeout(1000);
    return `Pressed key: ${key}`;
  } catch (err) { return `[ERROR] Key press failed: ${err}`; }
}

/**
 * Get the current page's text content.
 */
export async function browseGetText(sessionId: string): Promise<string> {
  const s = _sessions.get(sessionId);
  if (!s) return '[ERROR] No page open';
  return (await s.page.evaluate(() => {
    const main = document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
    return (main as HTMLElement).innerText?.substring(0, 15000) || '';
  }));
}

/**
 * Close a browsing session.
 */
export async function browseClose(sessionId: string): Promise<void> {
  const s = _sessions.get(sessionId);
  if (s) { try { await s.page.close(); } catch { } }
  _sessions.delete(sessionId);
}

/**
 * Close all browsing sessions.
 */
export async function browseCloseAll(): Promise<void> {
  for (const [, s] of _sessions) {
    try { await s.page.close(); } catch { }
  }
  _sessions.clear();
  if (_browsingContext) { try { await _browsingContext.close(); } catch { } _browsingContext = null; }
}
