import { describe, it, expect, vi } from 'vitest';

// Mock child_process — osascript returns structured JSON
vi.mock('child_process', () => {
  const fn = (_cmd: string, args: string[], _opts: any, cb: Function) => {
    const result = (globalThis as any).__testAXResult ?? '';
    const error = (globalThis as any).__testAXError ?? null;
    if (error) {
      cb(new Error(error), '', '');
    } else {
      cb(null, result, '');
    }
  };
  return { default: { execFile: fn }, execFile: fn };
});

import { readAccessibilityTree, flattenTreeToText } from '../electron/services/accessibilitySensor';
import type { UINode } from '../electron/services/accessibilitySensor';

function setAXResult(data: any) {
  (globalThis as any).__testAXResult = typeof data === 'string' ? data : JSON.stringify(data);
  (globalThis as any).__testAXError = null;
}

function setAXError(msg: string) {
  (globalThis as any).__testAXError = msg;
  (globalThis as any).__testAXResult = '';
}

describe('AccessibilitySensor', () => {

  // ── readAccessibilityTree ──

  it('1. should parse a valid AX tree result', async () => {
    setAXResult({
      appName: 'Microsoft Excel',
      windowTitle: 'Relatorio_Q1.xlsx',
      tree: [
        { role: 'AXToolbar', title: 'Toolbar', children: [
          { role: 'AXButton', title: 'Save' },
          { role: 'AXButton', title: 'Undo' },
        ]},
        { role: 'AXTable', title: 'Sheet1', value: 'A1:D10' },
      ],
      nodeCount: 4,
    });

    const result = await readAccessibilityTree();
    expect(result).not.toBeNull();
    expect(result!.appName).toBe('Microsoft Excel');
    expect(result!.windowTitle).toBe('Relatorio_Q1.xlsx');
    expect(result!.tree).toHaveLength(2);
    expect(result!.nodeCount).toBe(4);
    expect(result!.capturedAt).toBeTruthy();
  });

  it('2. should return null on error (permission denied)', async () => {
    setAXError('execution error: (-25211) assistive access not allowed');
    const result = await readAccessibilityTree();
    expect(result).toBeNull();
  });

  it('3. should return null for empty output', async () => {
    setAXResult('');
    const result = await readAccessibilityTree();
    expect(result).toBeNull();
  });

  it('4. should return null for error in JSON response', async () => {
    setAXResult({ error: 'no_frontmost' });
    const result = await readAccessibilityTree();
    expect(result).toBeNull();
  });

  it('5. should handle malformed JSON gracefully', async () => {
    (globalThis as any).__testAXResult = 'not valid json {{{';
    (globalThis as any).__testAXError = null;
    const result = await readAccessibilityTree();
    expect(result).toBeNull();
  });

  // ── flattenTreeToText ──

  it('6. should flatten a simple tree to readable text', () => {
    const tree: UINode[] = [
      { role: 'AXToolbar', title: 'Main Toolbar', children: [
        { role: 'AXButton', title: 'Save', description: 'Save document' },
        { role: 'AXButton', title: 'Print' },
      ]},
      { role: 'AXStaticText', value: 'Hello World' },
    ];

    const text = flattenTreeToText(tree);
    expect(text).toContain('Toolbar');
    expect(text).toContain('"Main Toolbar"');
    expect(text).toContain('Button "Save"');
    expect(text).toContain('(Save document)');
    expect(text).toContain('StaticText val=Hello World');
  });

  it('7. should respect maxChars limit', () => {
    const tree: UINode[] = [];
    for (let i = 0; i < 50; i++) {
      tree.push({ role: 'AXStaticText', value: `Long text content item number ${i} with enough words to fill space` });
    }

    const text = flattenTreeToText(tree, 200);
    expect(text.length).toBeLessThanOrEqual(210); // slight tolerance for last line
  });

  it('8. should handle empty tree', () => {
    const text = flattenTreeToText([]);
    expect(text).toBe('');
  });

  it('9. should indent children correctly', () => {
    const tree: UINode[] = [
      { role: 'AXWindow', title: 'Win', children: [
        { role: 'AXGroup', title: 'Panel', children: [
          { role: 'AXTextField', value: 'typed text' },
        ]},
      ]},
    ];

    const text = flattenTreeToText(tree);
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^Window/); // no indent
    expect(lines[1]).toMatch(/^\s{2}Group/); // 2-space indent
    expect(lines[2]).toMatch(/^\s{4}TextField/); // 4-space indent
  });
});

