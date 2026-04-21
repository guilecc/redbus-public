/**
 * PlaywrightService — Headless Chromium for general browser automation.
 * Runs in Main process and exposes aria-snapshot-based locator tools.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

let _browser: Browser | null = null;

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
  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

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

  const ctx = await _ensureBrowsingContext();

  const existing = _sessions.get(id);
  if (existing) { try { await existing.page.close(); } catch { } }

  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log(`[Playwright] browseOpen: waiting 3000ms for SPA render...`);
  await page.waitForTimeout(3000);
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
 * Access the Playwright Page for an open browse session.
 * Used by the deterministic static extractors to drive native locators
 * without going through the LLM-oriented ref map.
 */
export function getSessionPage(sessionId: string): Page | null {
  const s = _sessions.get(sessionId);
  return s?.page ?? null;
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
