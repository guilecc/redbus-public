/**
 * AccessibilitySensor — Lê a árvore de UI de aplicações nativas via macOS Accessibility API.
 *
 * Utiliza JXA (JavaScript for Automation) via `osascript -l JavaScript` para aceder
 * às APIs AXUIElement do macOS sem dependências nativas.
 *
 * Requisitos:
 *   - macOS com permissão de Acessibilidade concedida ao Electron/RedBus
 *   - Preferências do Sistema → Privacidade e Segurança → Acessibilidade
 *
 * Se a permissão não estiver concedida, falha silenciosamente com log limpo.
 */

import { execFile } from 'child_process';

/* ── Tipos ── */

export interface UINode {
  role: string;
  title?: string;
  value?: string;
  description?: string;
  children?: UINode[];
}

export interface AccessibilityTreeResult {
  appName: string;
  windowTitle: string;
  tree: UINode[];
  nodeCount: number;
  capturedAt: string;
}

/* ── JXA Script ──
 * Traverses the AX tree of the frontmost application's front window.
 * Max depth: 4 levels. Max nodes: 200. Filters out invisible/empty nodes.
 */
const JXA_READ_TREE = `
ObjC.import('Cocoa');
ObjC.import('ApplicationServices');

function run() {
  var se = Application('System Events');
  se.includeStandardAdditions = true;

  var procs = se.processes.whose({ frontmost: true });
  if (procs.length === 0) return JSON.stringify({ error: 'no_frontmost' });

  var proc = procs[0];
  var appName = proc.name();

  var wins = proc.windows();
  if (!wins || wins.length === 0) return JSON.stringify({ appName: appName, windowTitle: '', tree: [], nodeCount: 0 });

  var win = wins[0];
  var winTitle = '';
  try { winTitle = win.name() || ''; } catch(e) {}

  var count = { n: 0 };
  var MAX_NODES = 200;
  var MAX_DEPTH = 4;

  function readNode(el, depth) {
    if (count.n >= MAX_NODES || depth > MAX_DEPTH) return null;
    count.n++;

    var node = {};
    try { node.role = el.role() || ''; } catch(e) { node.role = 'unknown'; }
    try { var t = el.name(); if (t && t.length > 0) node.title = t.substring(0, 200); } catch(e) {}
    try { var v = el.value(); if (v !== null && v !== undefined && String(v).length > 0) node.value = String(v).substring(0, 300); } catch(e) {}
    try { var d = el.description(); if (d && d.length > 0) node.description = d.substring(0, 150); } catch(e) {}

    // Filter out noise: empty nodes with no useful info
    if (!node.title && !node.value && !node.description && node.role === 'AXGroup') return null;

    if (depth < MAX_DEPTH) {
      try {
        var kids = el.uiElements();
        if (kids && kids.length > 0) {
          var children = [];
          for (var i = 0; i < kids.length && count.n < MAX_NODES; i++) {
            var child = readNode(kids[i], depth + 1);
            if (child) children.push(child);
          }
          if (children.length > 0) node.children = children;
        }
      } catch(e) {}
    }

    return node;
  }

  var tree = [];
  try {
    var elems = win.uiElements();
    for (var i = 0; i < elems.length && count.n < MAX_NODES; i++) {
      var n = readNode(elems[i], 1);
      if (n) tree.push(n);
    }
  } catch(e) {}

  return JSON.stringify({ appName: appName, windowTitle: winTitle, tree: tree, nodeCount: count.n });
}
`;

/**
 * Read the accessibility tree of the currently focused native window.
 * Returns null if permission is missing or no frontmost window found.
 * Timeout: 5 seconds (some apps have deep trees).
 */
export function readAccessibilityTree(): Promise<AccessibilityTreeResult | null> {
  return new Promise((resolve) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', JXA_READ_TREE], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        // Permission denied or timeout — log cleanly and return null
        if (err.message?.includes('(-25211)') || err.message?.includes('assistive')) {
          console.warn('[AccessibilitySensor] Permissão de Acessibilidade não concedida. Ative em: Preferências do Sistema → Privacidade → Acessibilidade.');
        } else {
          console.warn('[AccessibilitySensor] Falha na leitura:', err.message?.slice(0, 100));
        }
        resolve(null);
        return;
      }

      try {
        const raw = (stdout || '').trim();
        if (!raw) { resolve(null); return; }
        const data = JSON.parse(raw);
        if (data.error) { resolve(null); return; }

        resolve({
          appName: data.appName || '',
          windowTitle: data.windowTitle || '',
          tree: data.tree || [],
          nodeCount: data.nodeCount || 0,
          capturedAt: new Date().toISOString(),
        });
      } catch (parseErr) {
        console.warn('[AccessibilitySensor] Erro ao parsear JSON da árvore AX');
        resolve(null);
      }
    });
  });
}

/**
 * Flatten the AX tree into a human-readable text summary for the Maestro prompt.
 * Limits output to ~maxChars characters.
 */
export function flattenTreeToText(tree: UINode[], maxChars = 2000): string {
  const lines: string[] = [];
  let charCount = 0;

  function visit(node: UINode, indent: number): void {
    if (charCount >= maxChars) return;

    const parts: string[] = [];
    const roleName = node.role?.replace('AX', '') || '?';
    parts.push(roleName);
    if (node.title) parts.push(`"${node.title}"`);
    if (node.value) parts.push(`val=${node.value.slice(0, 80)}`);
    if (node.description) parts.push(`(${node.description})`);

    const line = '  '.repeat(indent) + parts.join(' ');
    if (charCount + line.length > maxChars) return;
    lines.push(line);
    charCount += line.length + 1;

    if (node.children) {
      for (const child of node.children) {
        if (charCount >= maxChars) break;
        visit(child, indent + 1);
      }
    }
  }

  for (const node of tree) {
    if (charCount >= maxChars) break;
    visit(node, 0);
  }

  return lines.join('\n');
}

