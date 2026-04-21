/**
 * textSanitizer — deterministic HTML → plain-text pipeline.
 *
 * Spec 11 §4. Rule of thumb: the LLM never sees HTML, tables, quotes,
 * disclaimers, or signatures. Preserves Teams `@mentions` as `@Name`.
 */

import { parse, HTMLElement } from 'node-html-parser';

const STRIP_TAGS = new Set([
  'script', 'style', 'head', 'meta', 'link', 'img', 'svg',
  'video', 'audio', 'iframe', 'table',
]);

const SIGNATURE_RE = /(^--\s*$|^Atenciosamente,?\s*$|^Best regards,?\s*$|^Sent from my|^Cumprimentos,?\s*$|^Regards,?\s*$|^Cheers,?\s*$)/mi;

const DEFAULT_DISCLAIMER_PATTERNS = [
  /This e-?mail( and any files transmitted)?[\s\S]*?(confidential|privileged)[\s\S]*?(unauthorized|intended recipient)/i,
  /CONFIDENTIALITY NOTICE[\s\S]{0,800}/i,
  /Esta mensagem[\s\S]*?(confidencial|destinatário)[\s\S]*?(autorizada|destinatário)/i,
  /AVISO DE CONFIDENCIALIDADE[\s\S]{0,800}/i,
  /The information contained in this (e-?mail|transmission)[\s\S]*?(privileged|confidential)/i,
];

export interface SanitizeOptions {
  /** Extra regex patterns to strip. Merged with defaults. */
  disclaimerPatterns?: RegExp[];
  /** Hard cap (default 4000). */
  maxChars?: number;
  /** When true, treat `contentType === 'text'` (no HTML parse). */
  plainInput?: boolean;
}

/** Strip a Graph `body` payload (html or text) to a compact plain-text string. */
export function stripToPlainText(input: string, opts: SanitizeOptions = {}): string {
  if (!input) return '';
  const maxChars = opts.maxChars ?? 4000;

  let text: string;
  if (opts.plainInput || !/[<>]/.test(input)) {
    text = input;
  } else {
    text = _htmlToText(input);
  }

  // Collapse whitespace
  text = text.replace(/[ \t\f\v]+/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  // Truncate on signature
  const sigMatch = text.match(SIGNATURE_RE);
  if (sigMatch && sigMatch.index !== undefined) {
    text = text.slice(0, sigMatch.index).trim();
  }

  // Strip common disclaimers
  const patterns = [...DEFAULT_DISCLAIMER_PATTERNS, ...(opts.disclaimerPatterns || [])];
  for (const re of patterns) text = text.replace(re, '').trim();

  // Hard cap
  if (text.length > maxChars) {
    const headLen = Math.floor(maxChars * 0.875);
    const tailLen = maxChars - headLen - 20;
    text = `${text.slice(0, headLen)}\n…[truncado]\n${text.slice(-tailLen)}`;
  }

  return text;
}

function _htmlToText(html: string): string {
  let root: HTMLElement;
  try {
    root = parse(html, { lowerCaseTagName: true, comment: false });
  } catch {
    return html.replace(/<[^>]+>/g, ' ');
  }

  // Remove unwanted nodes
  _removeAll(root, (el) => STRIP_TAGS.has(el.rawTagName?.toLowerCase()));

  // Remove blockquotes and quote containers
  _removeAll(root, (el) => {
    const tag = el.rawTagName?.toLowerCase();
    if (tag === 'blockquote') return true;
    const cls = el.getAttribute('class') || '';
    if (/gmail_quote|yahoo_quoted|ms-outlook-mobile-references/i.test(cls)) return true;
    const id = el.getAttribute('id') || '';
    if (/^OLK_SRC_BODY_SECTION/i.test(id)) return true;
    if (/reply-?intro|divRplyFwdMsg/i.test(id)) return true;
    return false;
  });

  // Preserve Teams mentions: <at id="0">Name</at> → @Name
  const mentions = root.querySelectorAll('at');
  for (const at of mentions) {
    const name = (at.text || '').trim();
    at.replaceWith(`@${name} ` as any);
  }

  // Convert <br> / <p> boundaries into explicit newlines before flattening.
  // node-html-parser keeps these as elements — manual swap is cheapest.
  const html2 = root.toString()
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');

  // Cut anything after "From:" / "De:" header that typically starts a quoted thread
  const threadCut = html2.search(/\n\s*(From:|De:|Enviado em:|Sent:)\s/i);
  const cleaned = threadCut >= 0 ? html2.slice(0, threadCut) : html2;

  // Decode entities (node-html-parser doesn't always do this)
  return cleaned
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&zwnj;|&#8204;/gi, '')
    .replace(/&[a-z]+;/gi, ' ');
}

function _removeAll(root: HTMLElement, pred: (el: HTMLElement) => boolean): void {
  // Collect first, then remove — mutating during traversal mis-indexes siblings.
  const doomed: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    for (const child of el.childNodes as any[]) {
      if (child.nodeType === 1) {
        if (pred(child as HTMLElement)) doomed.push(child as HTMLElement);
        else walk(child as HTMLElement);
      }
    }
  };
  walk(root);
  for (const d of doomed) d.remove();
}

