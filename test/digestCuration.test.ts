/**
 * Tests for digest curation helpers: dedupByThread + cleanPreview.
 * Covers Spec 11 digest optimization: thread dedup and quoted-reply stripping.
 */

import { describe, it, expect } from 'vitest';
import {
  dedupByThread,
  cleanPreview,
  curateDigestMessages,
  DEFAULT_DIGEST_CURATION,
  type ThreadDedupInput,
  type CurationInput,
  type DigestCurationConfig,
} from '../electron/services/digestService';

type Item = ThreadDedupInput & { id: string };

function mk(over: Partial<Item>): Item {
  return {
    id: over.id || 'x',
    source: over.source || 'outlook',
    threadId: over.threadId,
    groupId: over.groupId,
    timestamp: over.timestamp || '2025-04-17T10:00:00Z',
    importance: over.importance,
    mentionsMe: over.mentionsMe,
    isUnread: over.isUnread,
  };
}

type CItem = CurationInput & { id: string };

function mkC(over: Partial<CItem>): CItem {
  return {
    id: over.id || 'x',
    source: over.source || 'teams',
    threadId: over.threadId,
    groupId: over.groupId,
    timestamp: over.timestamp || '2025-04-17T10:00:00Z',
    importance: over.importance,
    mentionsMe: over.mentionsMe,
    isUnread: over.isUnread,
    plainText: over.plainText || '',
  };
}

describe('dedupByThread', () => {
  it('collapses outlook items sharing a threadId to one representative', () => {
    const items = [
      mk({ id: 'a', threadId: 'T1', timestamp: '2025-04-17T10:00:00Z' }),
      mk({ id: 'b', threadId: 'T1', timestamp: '2025-04-17T11:00:00Z' }),
      mk({ id: 'c', threadId: 'T1', timestamp: '2025-04-17T09:00:00Z' }),
    ];
    const out = dedupByThread(items);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('b'); // newest wins when scores tied
  });

  it('prefers importance=high over newer timestamps', () => {
    const items = [
      mk({ id: 'a', threadId: 'T1', timestamp: '2025-04-17T10:00:00Z', importance: 'high' }),
      mk({ id: 'b', threadId: 'T1', timestamp: '2025-04-17T12:00:00Z', importance: 'normal' }),
    ];
    expect(dedupByThread(items)[0].id).toBe('a');
  });

  it('prefers mentionsMe over plain messages when importance ties', () => {
    const items = [
      mk({ id: 'a', threadId: 'T1', timestamp: '2025-04-17T10:00:00Z', mentionsMe: true }),
      mk({ id: 'b', threadId: 'T1', timestamp: '2025-04-17T12:00:00Z' }),
    ];
    expect(dedupByThread(items)[0].id).toBe('a');
  });

  it('groups teams by groupId (not threadId) and keeps outlook/teams groups separate', () => {
    const items = [
      mk({ id: 'e1', source: 'outlook', threadId: 'T1' }),
      mk({ id: 'e2', source: 'outlook', threadId: 'T1' }),
      mk({ id: 't1', source: 'teams', groupId: 'G1' }),
      mk({ id: 't2', source: 'teams', groupId: 'G1' }),
      mk({ id: 't3', source: 'teams', groupId: 'G2' }),
    ];
    const out = dedupByThread(items);
    expect(out).toHaveLength(3); // 1 outlook thread + 2 teams groups
  });

  it('passes items without thread/group key through as singletons', () => {
    const items = [
      mk({ id: 'a' }),
      mk({ id: 'b' }),
      mk({ id: 'c', threadId: 'T1' }),
      mk({ id: 'd', threadId: 'T1' }),
    ];
    const out = dedupByThread(items);
    expect(out).toHaveLength(3); // 2 singletons + 1 thread rep
  });

  it('returns items sorted by timestamp ascending', () => {
    const items = [
      mk({ id: 'a', timestamp: '2025-04-17T12:00:00Z' }),
      mk({ id: 'b', timestamp: '2025-04-17T09:00:00Z' }),
      mk({ id: 'c', timestamp: '2025-04-17T10:00:00Z' }),
    ];
    const out = dedupByThread(items);
    expect(out.map(i => i.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('cleanPreview', () => {
  it('cuts at "From:" thread marker', () => {
    const body = 'Oi, segue a resposta.\n\nFrom: foo@bar.com\nTo: me@acme.com\nSent: Thursday\n\nquoted stuff here';
    const out = cleanPreview(body, 'outlook');
    expect(out).not.toContain('quoted');
    expect(out).not.toContain('From:');
    expect(out).toContain('segue a resposta');
  });

  it('cuts at Portuguese "De:" thread marker', () => {
    const body = 'Oi Guilherme\n\nDe: foo@bar.com\nEnviado em: 17/04/2025\n\ntexto antigo';
    const out = cleanPreview(body, 'outlook');
    expect(out).toContain('Oi Guilherme');
    expect(out).not.toContain('texto antigo');
  });

  it('removes lines starting with > (quoted replies)', () => {
    const body = 'resposta nova\n> texto antigo\n> mais coisa\nfim';
    const out = cleanPreview(body, 'outlook');
    expect(out).toContain('resposta nova');
    expect(out).toContain('fim');
    expect(out).not.toContain('texto antigo');
    expect(out).not.toContain('mais coisa');
  });

  it('caps teams preview at 400 chars with ellipsis', () => {
    const body = 'a'.repeat(1000);
    const out = cleanPreview(body, 'teams');
    expect(out.length).toBeLessThanOrEqual(401); // 400 + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('caps outlook preview at 800 chars with ellipsis', () => {
    const body = 'x'.repeat(2000);
    const out = cleanPreview(body, 'outlook');
    expect(out.length).toBeLessThanOrEqual(801);
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not truncate short content', () => {
    const out = cleanPreview('short', 'teams');
    expect(out).toBe('short');
  });

  it('returns empty string for empty input', () => {
    expect(cleanPreview('', 'outlook')).toBe('');
  });

  it('handles "-----Original Message-----" marker', () => {
    const body = 'resposta curta\n\n-----Original Message-----\nFrom: x\nmuito texto';
    const out = cleanPreview(body, 'outlook');
    expect(out).toContain('resposta curta');
    expect(out).not.toContain('Original Message');
    expect(out).not.toContain('muito texto');
  });
});



describe('curateDigestMessages', () => {
  const cfg = DEFAULT_DIGEST_CURATION;

  it('drops standalone ack messages ("ok", "thanks", "valeu", "obrigado")', () => {
    const items: CItem[] = [
      mkC({ id: 'a', groupId: 'G1', plainText: 'ok', timestamp: '2025-04-17T10:00:00Z' }),
      mkC({ id: 'b', groupId: 'G1', plainText: 'thanks!', timestamp: '2025-04-17T10:01:00Z' }),
      mkC({ id: 'c', groupId: 'G1', plainText: 'valeu', timestamp: '2025-04-17T10:02:00Z' }),
      mkC({ id: 'd', groupId: 'G1', plainText: 'obrigado.', timestamp: '2025-04-17T10:03:00Z' }),
      mkC({ id: 'e', groupId: 'G1', plainText: 'pessoal, conseguimos fechar o deploy do sistema novo ontem à noite — tudo ok em produção e sem incidentes reportados.', timestamp: '2025-04-17T10:04:00Z' }),
    ];
    const out = curateDigestMessages(items, { ...cfg, alwaysKeepFirst: false, alwaysKeepLast: false });
    expect(out.map(i => i.id)).toEqual(['e']);
  });

  it('always keeps messages with a question mark as signal', () => {
    const items: CItem[] = [
      mkC({ id: 'q', groupId: 'G1', plainText: 'qual o plano pra sexta?', timestamp: '2025-04-17T10:00:00Z' }),
      mkC({ id: 'a', groupId: 'G1', plainText: 'ok', timestamp: '2025-04-17T10:01:00Z' }),
    ];
    const out = curateDigestMessages(items, { ...cfg, alwaysKeepFirst: false, alwaysKeepLast: false });
    expect(out.map(i => i.id)).toContain('q');
    expect(out.map(i => i.id)).not.toContain('a');
  });

  it('always keeps mentionsMe / importance=high regardless of length', () => {
    const items: CItem[] = [
      mkC({ id: 'm', groupId: 'G1', plainText: 'ok', mentionsMe: true, timestamp: '2025-04-17T10:00:00Z' }),
      mkC({ id: 'h', groupId: 'G1', plainText: 'tks', importance: 'high', timestamp: '2025-04-17T10:01:00Z' }),
      mkC({ id: 'n', groupId: 'G1', plainText: 'valeu', timestamp: '2025-04-17T10:02:00Z' }),
    ];
    const out = curateDigestMessages(items, { ...cfg, alwaysKeepFirst: false, alwaysKeepLast: false });
    const ids = out.map(i => i.id);
    expect(ids).toContain('m');
    expect(ids).toContain('h');
    expect(ids).not.toContain('n');
  });

  it('drops emoji-only messages as noise', () => {
    const items: CItem[] = [
      mkC({ id: 'em', groupId: 'G1', plainText: '👍🎉', timestamp: '2025-04-17T10:00:00Z' }),
      mkC({ id: 'ok', groupId: 'G1', plainText: 'conteúdo real explicando algo relevante pra análise do dia, com detalhe', timestamp: '2025-04-17T10:01:00Z' }),
    ];
    const out = curateDigestMessages(items, { ...cfg, alwaysKeepFirst: false, alwaysKeepLast: false });
    expect(out.map(i => i.id)).toEqual(['ok']);
  });

  it('keeps messages containing URLs as signal', () => {
    const items: CItem[] = [
      mkC({ id: 'u', groupId: 'G1', plainText: 'olha https://example.com', timestamp: '2025-04-17T10:00:00Z' }),
      mkC({ id: 'a', groupId: 'G1', plainText: 'ok', timestamp: '2025-04-17T10:01:00Z' }),
    ];
    const out = curateDigestMessages(items, { ...cfg, alwaysKeepFirst: false, alwaysKeepLast: false });
    expect(out.map(i => i.id)).toContain('u');
  });

  it('promotes long messages (>= signalLength) to signal', () => {
    const longText = 'a'.repeat(250);
    const items: CItem[] = [
      mkC({ id: 'L', groupId: 'G1', plainText: longText, timestamp: '2025-04-17T10:00:00Z' }),
      mkC({ id: 's', groupId: 'G1', plainText: 'ok', timestamp: '2025-04-17T10:01:00Z' }),
    ];
    const out = curateDigestMessages(items, { ...cfg, alwaysKeepFirst: false, alwaysKeepLast: false, signalLength: 200 });
    expect(out.map(i => i.id)).toContain('L');
  });

  it('alwaysKeepFirst/Last preserves thread boundaries even when noise', () => {
    const items: CItem[] = [
      mkC({ id: 'first', groupId: 'G1', plainText: 'ok', timestamp: '2025-04-17T09:00:00Z' }),
      mkC({ id: 'mid', groupId: 'G1', plainText: 'tks', timestamp: '2025-04-17T10:00:00Z' }),
      mkC({ id: 'last', groupId: 'G1', plainText: 'valeu', timestamp: '2025-04-17T11:00:00Z' }),
    ];
    const out = curateDigestMessages(items, { ...cfg, alwaysKeepFirst: true, alwaysKeepLast: true });
    const ids = out.map(i => i.id);
    expect(ids).toContain('first');
    expect(ids).toContain('last');
    expect(ids).not.toContain('mid');
  });

  it('caps neutral messages per thread to neutralCapPerThread', () => {
    const items: CItem[] = Array.from({ length: 10 }, (_, i) =>
      mkC({ id: `n${i}`, groupId: 'G1', plainText: `mensagem neutra número ${i} com conteúdo suficiente pra passar do minLength`, timestamp: `2025-04-17T10:0${i}:00Z` })
    );
    const out = curateDigestMessages(items, { ...cfg, alwaysKeepFirst: false, alwaysKeepLast: false, neutralCapPerThread: 2 });
    expect(out).toHaveLength(2);
    // Expect boundary picks: first + last of the neutral run
    expect(out.map(i => i.id)).toEqual(['n0', 'n9']);
  });

  it('returns items sorted by timestamp ascending', () => {
    const items: CItem[] = [
      mkC({ id: 'a', groupId: 'G1', plainText: 'mensagem com conteúdo real explicando algo', timestamp: '2025-04-17T12:00:00Z' }),
      mkC({ id: 'b', groupId: 'G2', plainText: 'outra mensagem com conteúdo real diferente', timestamp: '2025-04-17T09:00:00Z' }),
    ];
    const out = curateDigestMessages(items, cfg);
    expect(out.map(i => i.id)).toEqual(['b', 'a']);
  });

  it('treats items without thread/group key as singletons (noise dropped, signal kept)', () => {
    const items: CItem[] = [
      mkC({ id: 'loose1', plainText: 'ok' }),                                             // noise → drop
      mkC({ id: 'loose2', plainText: 'tem alguma dúvida sobre o relatório?' }),          // signal (?) → keep
      mkC({ id: 'loose3', plainText: 'mensagem neutra normal com tamanho suficiente pra passar' }), // neutral → keep (no thread cap applies)
    ];
    const out = curateDigestMessages(items, { ...cfg, alwaysKeepFirst: false, alwaysKeepLast: false });
    const ids = out.map(i => i.id);
    expect(ids).not.toContain('loose1');
    expect(ids).toContain('loose2');
    expect(ids).toContain('loose3');
  });

  it('customAckPatterns extend the default noise list', () => {
    const customCfg: DigestCurationConfig = {
      ...cfg,
      alwaysKeepFirst: false,
      alwaysKeepLast: false,
      customAckPatterns: ['rgr', 'pode crer'],
    };
    const items: CItem[] = [
      mkC({ id: 'a', groupId: 'G1', plainText: 'rgr', timestamp: '2025-04-17T10:00:00Z' }),
      mkC({ id: 'b', groupId: 'G1', plainText: 'pode crer', timestamp: '2025-04-17T10:01:00Z' }),
      mkC({ id: 'c', groupId: 'G1', plainText: 'conteúdo real e substancial sobre o andamento do projeto x', timestamp: '2025-04-17T10:02:00Z' }),
    ];
    const out = curateDigestMessages(items, customCfg);
    expect(out.map(i => i.id)).toEqual(['c']);
  });

  it('keeps both signal and capped neutrals in the same thread', () => {
    const items: CItem[] = [
      mkC({ id: 'q', groupId: 'G1', plainText: 'alguém viu o relatório final?', timestamp: '2025-04-17T09:00:00Z' }), // signal
      mkC({ id: 'n1', groupId: 'G1', plainText: 'acho que foi pro drive outro dia', timestamp: '2025-04-17T10:00:00Z' }),
      mkC({ id: 'n2', groupId: 'G1', plainText: 'procurei lá e não achei nada', timestamp: '2025-04-17T11:00:00Z' }),
      mkC({ id: 'n3', groupId: 'G1', plainText: 'deixa eu dar uma olhada aqui também', timestamp: '2025-04-17T12:00:00Z' }),
      mkC({ id: 'n4', groupId: 'G1', plainText: 'também vou procurar no slack', timestamp: '2025-04-17T13:00:00Z' }),
    ];
    const out = curateDigestMessages(items, { ...cfg, alwaysKeepFirst: false, alwaysKeepLast: false, neutralCapPerThread: 2 });
    const ids = out.map(i => i.id);
    expect(ids).toContain('q');               // signal always kept
    expect(ids.filter(id => id.startsWith('n'))).toHaveLength(2); // neutrals capped to 2
  });

  it('empty input returns empty array', () => {
    expect(curateDigestMessages([], cfg)).toEqual([]);
  });
});