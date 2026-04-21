/**
 * Browser tool plugins (Spec 09, Phase 3).
 *
 * Registers the 6 browser-action tools with the plugin registry so the
 * unified agent runner dispatches via `getTool()` instead of a hardcoded
 * switch. Each tool needs a live Playwright session id, which the runner
 * passes through `ctx.browserSessionId`.
 *
 * Schemas live in `worker-tools.ts` (`WORKER_TOOL_SCHEMAS`) — this file
 * owns the executors. Terminal tools (`commit_extracted_data`) and the
 * HITL checkpoints (`request_explicit_human_consent`,
 * `request_user_authentication`) remain special-cased in `runAttempt`
 * because they control loop termination and UI side-effects.
 */
import type { ToolPlugin, ToolContext } from './types';
import { pluginApi } from './registry';
import { browseSnapshot, browseClick, browseType, browsePressKey } from '../services/playwrightService';

const SNAPSHOT_BYTES = 20000;

function requireSession(ctx: ToolContext): string {
  const sid = (ctx as any).browserSessionId;
  if (!sid) throw new Error('browser_* tools require a browserSessionId in context');
  return sid;
}

const browserSnapshotTool: ToolPlugin = {
  name: 'browser_snapshot',
  description: 'Takes a snapshot of the current page accessibility tree.',
  parameters: { type: 'object', properties: {} },
  async execute(_id, _params, ctx) {
    const sid = requireSession(ctx);
    const snap = await browseSnapshot(sid);
    return `Page snapshot:\n${snap.substring(0, SNAPSHOT_BYTES)}`;
  },
};

const browserClickTool: ToolPlugin = {
  name: 'browser_click',
  description: 'Clicks an element identified by its [ref=eN] marker.',
  parameters: {
    type: 'object',
    properties: { ref: { type: 'string' } },
    required: ['ref'],
  },
  async execute(_id, params, ctx) {
    const sid = requireSession(ctx);
    const result = await browseClick(sid, params.ref);
    const snap = await browseSnapshot(sid);
    return `${result}.\nNew snapshot:\n${snap.substring(0, SNAPSHOT_BYTES)}`;
  },
};

const browserTypeTool: ToolPlugin = {
  name: 'browser_type',
  description: 'Types text into an input element identified by its ref.',
  parameters: {
    type: 'object',
    properties: {
      ref: { type: 'string' },
      text: { type: 'string' },
      submit: { type: 'boolean' },
    },
    required: ['ref', 'text'],
  },
  async execute(_id, params, ctx) {
    const sid = requireSession(ctx);
    const result = await browseType(sid, params.text, params.ref);
    if (params.submit) await browsePressKey(sid, 'Enter');
    const snap = await browseSnapshot(sid);
    return `${result}${params.submit ? ' + Enter' : ''}.\nNew snapshot:\n${snap.substring(0, SNAPSHOT_BYTES)}`;
  },
};

const browserPressKeyTool: ToolPlugin = {
  name: 'browser_press_key',
  description: 'Presses a keyboard key on the focused element.',
  parameters: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key'],
  },
  async execute(_id, params, ctx) {
    const sid = requireSession(ctx);
    await browsePressKey(sid, params.key);
    const snap = await browseSnapshot(sid);
    return `Pressed ${params.key}.\nNew snapshot:\n${snap.substring(0, SNAPSHOT_BYTES)}`;
  },
};

const browserScrollDownTool: ToolPlugin = {
  name: 'browser_scroll_down',
  description: 'Scrolls the page down by ~2/3 viewport.',
  parameters: { type: 'object', properties: {} },
  async execute(_id, _params, ctx) {
    const sid = requireSession(ctx);
    await browsePressKey(sid, 'PageDown');
    const snap = await browseSnapshot(sid);
    return `Scrolled down.\nNew snapshot:\n${snap.substring(0, SNAPSHOT_BYTES)}`;
  },
};

const browserScrollUpTool: ToolPlugin = {
  name: 'browser_scroll_up',
  description: 'Scrolls the page up by ~2/3 viewport.',
  parameters: { type: 'object', properties: {} },
  async execute(_id, _params, ctx) {
    const sid = requireSession(ctx);
    await browsePressKey(sid, 'PageUp');
    const snap = await browseSnapshot(sid);
    return `Scrolled up.\nNew snapshot:\n${snap.substring(0, SNAPSHOT_BYTES)}`;
  },
};

export const BROWSER_TOOL_NAMES = [
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_scroll_down',
  'browser_scroll_up',
] as const;

export function registerBrowserToolBuiltins(): void {
  pluginApi.registerTool(browserSnapshotTool);
  pluginApi.registerTool(browserClickTool);
  pluginApi.registerTool(browserTypeTool);
  pluginApi.registerTool(browserPressKeyTool);
  pluginApi.registerTool(browserScrollDownTool);
  pluginApi.registerTool(browserScrollUpTool);
}

