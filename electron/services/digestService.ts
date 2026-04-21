/**
 * DigestService — generates daily communication digests from channel messages.
 * Extracts messages → groups by topic → LLM summarizes → saves to CommunicationDigest table.
 */
import { v4 as uuidv4 } from 'uuid';

/**
 * Minimal structural shape for thread deduplication. Matches the fields used
 * from `CommunicationItem` so callers don't need to import that type.
 */
export interface ThreadDedupInput {
  id: string;
  source: 'outlook' | 'teams';
  threadId?: string;
  groupId?: string;
  timestamp: string;
  importance?: 'low' | 'normal' | 'high';
  mentionsMe?: boolean;
  isUnread?: boolean;
}

/**
 * Dedup messages by thread/chat so the digest prompt doesn't repeat the same
 * conversation N times. Groups Outlook by `threadId` and Teams by `groupId`;
 * items without a group key pass through unchanged (treated as singletons).
 *
 * Representative selection within a group:
 *   1. `importance === 'high'` > anything else
 *   2. `mentionsMe === true` > not mentioned
 *   3. `isUnread === true` > read
 *   4. newest `timestamp`
 *
 * Returns items in the same order callers expect (sorted by timestamp asc).
 */
export function dedupByThread<T extends ThreadDedupInput>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  const singletons: T[] = [];
  for (const it of items) {
    const key = it.source === 'outlook' ? it.threadId : it.groupId;
    if (!key) { singletons.push(it); continue; }
    const bucket = groups.get(`${it.source}:${key}`);
    if (bucket) bucket.push(it); else groups.set(`${it.source}:${key}`, [it]);
  }
  const score = (it: T): number => {
    let s = 0;
    if (it.importance === 'high') s += 1000;
    if (it.mentionsMe) s += 100;
    if (it.isUnread) s += 10;
    return s;
  };
  const reps: T[] = [];
  for (const bucket of groups.values()) {
    let best = bucket[0];
    for (let i = 1; i < bucket.length; i++) {
      const c = bucket[i];
      const ds = score(c) - score(best);
      if (ds > 0) { best = c; continue; }
      if (ds < 0) continue;
      if ((c.timestamp || '') > (best.timestamp || '')) best = c;
    }
    reps.push(best);
  }
  return [...reps, ...singletons].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
}

/**
 * Patterns indicating the start of a quoted reply in plain-text email bodies.
 * Matches on its own line (or preceded by whitespace) so mid-sentence mentions
 * of "from:" don't trigger a cut.
 */
const QUOTED_REPLY_CUT_RE = /\n\s*(?:From:|De:|Sent:|Enviado em:|Enviado por:|Em .+ escreveu:|On .+ wrote:|-----\s*Original Message\s*-----)/i;
const LEADING_QUOTE_LINE_RE = /^(?:>|\|)\s?.*$/gm;

/**
 * Default short-message acknowledgment patterns (PT + EN) considered "noise"
 * when `dropAcks` is enabled. Matched as the entire message body (after
 * trimming / stripping emoji / trailing punctuation). Users can extend this
 * list via `DigestCurationConfig.customAckPatterns`.
 */
const DEFAULT_ACK_PATTERNS: string[] = [
  // english — acknowledgments
  'ok', 'okay', 'okk', 'okey', 'k', 'kk', 'kkk',
  'thanks', 'thank you', 'thx', 'tks', 'ty', 'tysm',
  'got it', 'sounds good', 'will do', 'noted', 'understood',
  'sure', 'yes', 'yep', 'yeah', 'no', 'nope', 'np',
  'cool', 'nice', 'great', 'awesome', 'perfect',
  '+1', '-1',
  // portuguese — acknowledgments & greetings
  'valeu', 'vlw', 'obrigado', 'obrigada', 'obg', 'obgda',
  'perfeito', 'ótimo', 'otimo', 'blz', 'beleza',
  'entendi', 'entendido', 'faço sim', 'faço', 'pode deixar',
  'certo', 'sim', 'não', 'nao', 'show', 'bacana',
  'bom dia', 'boa tarde', 'boa noite', 'oi', 'olá', 'ola', 'e aí', 'eai',
];

/** Rough emoji / symbol unicode ranges used to detect emoji-only messages. */
const EMOJI_STRIP_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{200D}]/gu;

export interface DigestCurationConfig {
  /** Drop messages whose body is just an acknowledgment (ok/thanks/valeu/…). */
  dropAcks: boolean;
  /** Below this length (after emoji-strip) a neutral message is treated as noise. */
  minLength: number;
  /** At or above this length a message is auto-promoted to signal and always kept. */
  signalLength: number;
  /** Cap for "neutral" (non-signal / non-noise) messages kept per thread. */
  neutralCapPerThread: number;
  /** Always keep the oldest message in each thread (opener) even if it's noise. */
  alwaysKeepFirst: boolean;
  /** Always keep the newest message in each thread (current state) even if it's noise. */
  alwaysKeepLast: boolean;
  /** Extra ack-style patterns to drop on top of the built-in list. */
  customAckPatterns: string[];
}

/** Balanced defaults — tuned for ~300 msg days on Teams-heavy accounts. */
export const DEFAULT_DIGEST_CURATION: DigestCurationConfig = {
  dropAcks: true,
  minLength: 10,
  signalLength: 200,
  neutralCapPerThread: 2,
  alwaysKeepFirst: true,
  alwaysKeepLast: true,
  customAckPatterns: [],
};

/** Input shape for `curateDigestMessages` — extends the dedup input with body text. */
export interface CurationInput extends ThreadDedupInput {
  plainText?: string;
}

type Classification = 'signal' | 'noise' | 'neutral';

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAckRegex(config: DigestCurationConfig): RegExp {
  const all = [...DEFAULT_ACK_PATTERNS, ...(config.customAckPatterns || [])]
    .map(p => (p || '').trim()).filter(Boolean).map(escapeForRegex);
  // Whole-message match after trim. Allow trailing punctuation / spaces.
  return new RegExp(`^(?:${all.join('|')})[\\s!.?,;…]*$`, 'i');
}

function classifyMessage(item: CurationInput, config: DigestCurationConfig, ackRegex: RegExp): Classification {
  const raw = (item.plainText || '').trim();
  // Signal wins first — these hints should never be silenced by a length rule.
  if (item.importance === 'high') return 'signal';
  if (item.mentionsMe) return 'signal';
  if (raw.length >= config.signalLength) return 'signal';
  if (raw.includes('?')) return 'signal';
  if (/https?:\/\//i.test(raw)) return 'signal';
  if (/(^|\s)@[A-Za-zÀ-ÿ0-9_.-]/.test(raw)) return 'signal';
  // Noise filters on the emoji-stripped body.
  const stripped = raw.replace(EMOJI_STRIP_RE, '').trim();
  if (stripped.length === 0) return 'noise';
  if (config.dropAcks && ackRegex.test(stripped)) return 'noise';
  if (stripped.length < Math.max(1, config.minLength)) return 'noise';
  return 'neutral';
}

/**
 * Smart curation: keeps signal, drops noise, caps neutral chatter per thread.
 *
 * Three layers applied in order:
 *   1. **Signal preservation** — `importance=high`, `mentionsMe`, questions,
 *      URLs, @mentions or length ≥ `signalLength` always pass.
 *   2. **Noise filter** — ack patterns (ok/thanks/valeu/…), emoji-only,
 *      and bodies shorter than `minLength` (after emoji strip) are dropped.
 *   3. **Neutral cap per thread** — grouped by `threadId`/`groupId`, keeps at
 *      most `neutralCapPerThread` neutral messages (preferring boundary ones).
 *      `alwaysKeepFirst` / `alwaysKeepLast` force the thread opener / current
 *      state to survive even if classified as noise.
 *
 * Messages without a thread/group key are treated as singletons: noise dropped,
 * signal/neutral kept.
 *
 * Output is sorted by timestamp ascending.
 */
export function curateDigestMessages<T extends CurationInput>(
  items: T[],
  config: DigestCurationConfig = DEFAULT_DIGEST_CURATION,
): T[] {
  if (items.length === 0) return [];
  const ackRegex = buildAckRegex(config);
  const classified = items.map(item => ({ item, klass: classifyMessage(item, config, ackRegex) }));

  const groups = new Map<string, typeof classified>();
  const loose: typeof classified = [];
  for (const c of classified) {
    const key = c.item.source === 'outlook' ? c.item.threadId : c.item.groupId;
    if (!key) { loose.push(c); continue; }
    const gk = `${c.item.source}:${key}`;
    const bucket = groups.get(gk);
    if (bucket) bucket.push(c); else groups.set(gk, [c]);
  }

  const kept: T[] = [];
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => (a.item.timestamp || '').localeCompare(b.item.timestamp || ''));
    const keepIdx = new Set<number>();
    for (let i = 0; i < bucket.length; i++) if (bucket[i].klass === 'signal') keepIdx.add(i);
    if (config.alwaysKeepFirst) keepIdx.add(0);
    if (config.alwaysKeepLast) keepIdx.add(bucket.length - 1);
    const neutralIdx: number[] = [];
    for (let i = 0; i < bucket.length; i++) if (bucket[i].klass === 'neutral' && !keepIdx.has(i)) neutralIdx.push(i);
    const cap = Math.max(0, config.neutralCapPerThread);
    if (neutralIdx.length <= cap) {
      for (const i of neutralIdx) keepIdx.add(i);
    } else if (cap > 0) {
      keepIdx.add(neutralIdx[0]);
      if (cap >= 2) keepIdx.add(neutralIdx[neutralIdx.length - 1]);
      const extra = cap - 2;
      if (extra > 0 && neutralIdx.length > 2) {
        const step = (neutralIdx.length - 1) / (extra + 1);
        for (let k = 1; k <= extra; k++) keepIdx.add(neutralIdx[Math.round(k * step)]);
      }
    }
    for (const i of keepIdx) kept.push(bucket[i].item);
  }
  for (const c of loose) if (c.klass !== 'noise') kept.push(c.item);
  return kept.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
}

/**
 * Shrinks a message body for inclusion in the digest prompt.
 * - Removes `> quoted` lines typical of plain-text replies.
 * - Cuts anything after the first "From:/De:/Sent:" thread marker.
 * - Collapses whitespace and caps length per source (Teams 400, Outlook 800).
 *
 * Input is already sanitized HTML-free text from `stripToPlainText`; this is
 * a second pass targeting quote cruft that survived ingest.
 */
export function cleanPreview(text: string, source: 'outlook' | 'teams' | string): string {
  if (!text) return '';
  let t = text;
  const cut = t.search(QUOTED_REPLY_CUT_RE);
  if (cut >= 0) t = t.slice(0, cut);
  t = t.replace(LEADING_QUOTE_LINE_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  const cap = source === 'teams' ? 400 : 800;
  if (t.length > cap) t = t.slice(0, cap).trimEnd() + '…';
  return t;
}

export interface DigestMessage {
  channel: string;
  sender: string;
  subject?: string;
  preview: string;
  timestamp?: string | null;
  isUnread?: boolean;
  // Spec 11 §7: optional signal hints the curation step propagates into the prompt.
  importance?: 'low' | 'normal' | 'high';
  mentionsMe?: boolean;
}

export interface DigestTopic {
  title: string;
  summary: string;
  messages: Array<{ sender: string; subject?: string; preview: string }>;
  priority: 'high' | 'medium' | 'low';
  addressing?: 'direct' | 'cc' | 'mention' | 'broadcast' | 'unknown';
}

export interface DigestSummary {
  executive_summary: string;
  topics: DigestTopic[];
  action_items: string[];
  total_messages: number;
  channels: string[];
}

/**
 * Identity hint passed into the LLM prompt so the digest can recognize when
 * a message is directly addressed to the user (To/CC/mentions/subject/body).
 *
 * `professional_aliases` — nicknames / shortened forms / alternate spellings
 * the user may be called by in emails and Teams chats (e.g. "Gui" for
 * "Guilherme"). Treated with the same weight as `professional_name` when
 * classifying addressing.
 */
export interface DigestUserContext {
  professional_name?: string;
  professional_email?: string;
  professional_aliases?: string[];
}

/**
 * Best-effort repair of truncated JSON produced by an LLM that hit its output
 * token limit mid-response.  The strategy is conservative:
 *
 *  1. Walk the string tracking open `{` / `[` and string state.
 *  2. Find the last position where the JSON is structurally "safe" to close
 *     (i.e. right after a complete value inside an array/object).
 *  3. Append the closing brackets/braces needed to make the fragment valid.
 *
 * Returns the parsed object on success, or `null` if repair fails.
 */
function tryRepairJson(raw: string): any | null {
  const stack: Array<'{' | '['> = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{' || ch === '[') {
      stack.push(ch as '{' | '[');
    } else if (ch === '}' || ch === ']') {
      stack.pop();
    }
  }

  if (stack.length === 0) return null;

  let fragment = raw.trimEnd();

  // If we ended inside a string, close it
  if (inString) fragment += '"';

  // Clean trailing punctuation before closing
  while (fragment.endsWith(',') || fragment.endsWith(':')) {
    fragment = fragment.slice(0, -1).trimEnd();
  }

  // Close all pending structures
  const closers = stack.reverse().map(b => b === '{' ? '}' : ']');
  fragment += closers.join('');

  try {
    return JSON.parse(fragment);
  } catch {
    // Second pass: if it still fails, try to cut back to the last successful separator
    // but usually the first pass with careful closing is enough for truncated JSON.
    return null;
  }
}

/** 
 * Cleans common LLM syntax errors (trailing commas, unquoted keys) 
 * that the native JSON.parse rejects.
 */
function sanitizeJson(raw: string): string {
  let s = raw.trim();
  // Remove markdown code blocks if present
  s = s.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  
  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, '$1');
  
  // Basic fix for unquoted keys (e.g. { key: "val" } -> { "key": "val" })
  // Only targets simple word keys followed by a colon
  s = s.replace(/([{,]\s*)([a-z_][a-z0-9_]*)\s*:/gi, '$1"$2":');
  
  return s;
}

/**
 * Generate a digest from extracted messages using LLM.
 *
 * `userContext` — optional identity hint. When provided, the prompt asks the
 * LLM to classify each topic's `addressing` (direct/cc/mention/broadcast) and
 * to prioritize communications actually aimed at the user.
 */
export async function generateDigestFromMessages(
  messages: DigestMessage[],
  callLLM: (prompt: string) => Promise<string>,
  userContext?: DigestUserContext,
): Promise<DigestSummary> {
  if (messages.length === 0) {
    return {
      executive_summary: 'Nenhuma mensagem foi encontrada nos canais conectados para este dia. Verifique se os canais estão conectados e se há mensagens visíveis no Outlook/Teams.',
      topics: [],
      action_items: [],
      total_messages: 0,
      channels: [],
    };
  }

  const channels = [...new Set(messages.map(m => m.channel))];

  // Format messages for LLM — separate by channel for clarity
  const outlookMsgs = messages.filter(m => m.channel === 'outlook');
  const teamsMsgs = messages.filter(m => m.channel === 'teams');

  // Cap preview per message so the input block doesn't blow up token budget.
  const PREVIEW_CAP = 200;
  const capPreview = (s: string) => s.length > PREVIEW_CAP ? s.slice(0, PREVIEW_CAP) + '…' : s;

  // Spec 11 §7: inline importance / mentionsMe hints so the prompt can weigh them.
  const flagSuffix = (m: DigestMessage) => {
    const parts: string[] = [];
    if (m.isUnread) parts.push('NÃO LIDO');
    if (m.importance === 'high') parts.push('IMPORTANCE=HIGH');
    if (m.mentionsMe) parts.push('MENTIONS_ME');
    return parts.length ? ` [${parts.join(' | ')}]` : '';
  };

  let messagesBlock = '';
  if (outlookMsgs.length > 0) {
    messagesBlock += '=== CANAL: outlook (E-mails Outlook) ===\n';
    messagesBlock += outlookMsgs.map((m, i) =>
      `ID: OUT-${i + 1}\nRemetente: ${m.sender}${m.subject ? `\nAssunto: ${m.subject}` : ''}${flagSuffix(m)}\nConteúdo: ${capPreview(m.preview)}`
    ).join('\n\n');
  }
  if (teamsMsgs.length > 0) {
    messagesBlock += '\n\n=== CANAL: teams (Chat do Microsoft Teams) ===\n';
    messagesBlock += teamsMsgs.map((m, i) =>
      `ID: TEM-${i + 1}\nRemetente: ${m.sender}${flagSuffix(m)}\nConteúdo: ${capPreview(m.preview)}`
    ).join('\n\n');
  }
  // Include any other channels
  const otherMsgs = messages.filter(m => m.channel !== 'outlook' && m.channel !== 'teams');
  if (otherMsgs.length > 0) {
    messagesBlock += '\n\n=== OUTROS CANAIS ===\n';
    messagesBlock += otherMsgs.map((m, i) =>
      `ID: OTHER-${i + 1}\nCanal: ${m.channel}\nRemetente: ${m.sender}\nConteúdo: ${capPreview(m.preview)}`
    ).join('\n\n');
  }

  // Identity block — instructs the LLM to reason about whether each message
  // is actually addressed to the user, instead of treating every email/chat
  // as equally relevant. Falls back to a neutral note when unset.
  const aliases = (userContext?.professional_aliases ?? []).filter((a) => a && a.trim().length > 0);
  const hasIdentity = !!(userContext?.professional_name || userContext?.professional_email || aliases.length > 0);
  const aliasesLine = aliases.length > 0
    ? `Apelidos / variações de nome: ${aliases.map((a) => `"${a}"`).join(', ')}`
    : `Apelidos / variações de nome: (nenhum informado)`;
  const identityBlock = hasIdentity
    ? `=== IDENTIDADE DO USUÁRIO ===
Nome profissional: ${userContext?.professional_name || '(não informado)'}
E-mail corporativo: ${userContext?.professional_email || '(não informado)'}
${aliasesLine}

Qualquer ocorrência do nome profissional OU de um dos apelidos acima (case-insensitive, como palavra/segmento) no To:, CC:, @menção, assunto ou corpo da mensagem conta como referência direta ao usuário.

Use estes dados para classificar o campo "addressing" de cada tópico:
- "direct": mensagem endereçada diretamente ao usuário (To: contém o e-mail dele, @menção com o nome/apelido dele no Teams, ou o corpo/assunto interpela o usuário pelo nome ou por um dos apelidos).
- "cc": o usuário está em cópia, mas não é o destinatário principal.
- "mention": o nome/apelido/e-mail aparece no corpo mas sem pedido de ação ao usuário.
- "broadcast": comunicação ampla (newsletter, all-hands, lista) sem foco no usuário.
- "unknown": não dá pra inferir pelos dados disponíveis.

PRIORIZE mensagens "direct": elas devem aparecer primeiro em "topics", com priority "high" quando houver pedido explícito de ação. Rebaixe "broadcast" para priority "low" salvo se o conteúdo tiver urgência óbvia.`
    : `=== IDENTIDADE DO USUÁRIO ===
(não informada — trate todas as mensagens como igualmente relevantes e use addressing "unknown")`;

  const prompt = `Você é um assistente executivo pessoal. Sua tarefa é analisar emails e mensagens e produzir um briefing diário claro, acionável e com fontes explicitamente citadas.

${identityBlock}

${messagesBlock}

---

Com base nas comunicações acima, produza um briefing executivo em JSON. Siga estas regras CRÍTICAS de citação e formatação:

1. **Citação de Fontes no Texto**: Em todos os campos de texto ("executive_summary" e "summary" de cada tópico), você DEVE citar explicitamente a fonte da informação:
   - **Para Emails (Outlook)**: Use o formato "Conforme o email com assunto '[Assunto]' enviado por [Sender]...".
   - **Para Mensagens de Chat (Teams)**: Use o formato "No chat do Teams com [Sender]..." ou "Na conversa do Teams com [Sender]...".

2. **Resumo executivo**: 2-4 frases descrevendo o panorama do dia. Destaque PRIMEIRO o que é endereçado diretamente ao usuário (addressing="direct"). Use as regras de citação acima.

3. **Tópicos**: Agrupe as mensagens por projeto ou tema. Máximo de 12 tópicos — agrupe os menores em "Outros" se necessário. Cada tópico deve ter:
   - **title**: Título claro e profissional (≤ 8 palavras).
   - **summary**: 1-3 frases descrevendo o que está acontecendo, citando as fontes conforme a regra 1. Seja conciso.
   - **priority**: "high" (urgente), "medium" (importante) ou "low" (informativo). Priorize "high" quando a mensagem tiver os marcadores **IMPORTANCE=HIGH** ou **MENTIONS_ME**.
   - **addressing**: "direct" | "cc" | "mention" | "broadcast" | "unknown" — conforme definido no bloco IDENTIDADE DO USUÁRIO.
   - **msg_ids**: Lista dos IDs das mensagens originais que compõem este tópico (ex: ["OUT-1", "TEM-3"]).

4. **Itens de ação**: Liste APENAS ações concretas pedidas ao usuário (ex: "Responder email de [Sender] sobre [Assunto]"). Não invente ações a partir de "broadcast". Máximo de 10 itens.

Retorne APENAS um JSON válido (sem markdown, sem \`\`\`) com esta estrutura:
{
  "executive_summary": "Sumário com citações...",
  "topics": [
    {
      "title": "Projeto X",
      "summary": "Resumo conciso com citações...",
      "priority": "high|medium|low",
      "addressing": "direct|cc|mention|broadcast|unknown",
      "msg_ids": ["OUT-1", "TEM-2"]
    }
  ],
  "action_items": ["Ação 1", "Ação 2"]
}

Ordene "topics" por addressing (direct > cc > mention > broadcast > unknown) e dentro de cada grupo por priority. Responda em português.`;

  // Build a lookup map from prompt IDs → original DigestMessage objects so we
  // can reconstruct the per-topic `messages` array from the compact `msg_ids`
  // field (the LLM no longer echoes full message objects to save output tokens).
  // Per-channel indices must match the IDs emitted in the prompt above.
  const idxOutlook = outlookMsgs.map((m, i) => [`OUT-${i + 1}`, m] as const);
  const idxTeams = teamsMsgs.map((m, i) => [`TEM-${i + 1}`, m] as const);
  const idxOther = otherMsgs.map((m, i) => [`OTHER-${i + 1}`, m] as const);
  const promptIdMap = new Map<string, DigestMessage>([...idxOutlook, ...idxTeams, ...idxOther]);

  try {
    const response = await callLLM(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in LLM response');

    // Attempt resilient parse: if direct parse fails try to repair truncated JSON.
    let parsed: any;
    const sanitized = sanitizeJson(jsonMatch[0]);
    try {
      parsed = JSON.parse(sanitized);
    } catch (parseErr) {
      console.warn('[DigestService] Direct JSON parse failed, attempting repair…', parseErr);
      parsed = tryRepairJson(sanitized);
      if (!parsed) throw parseErr; // still broken — fall through to sender-group fallback
    }

    return {
      executive_summary: parsed.executive_summary || '',
      topics: (parsed.topics || []).map((t: any) => {
        // Reconstruct messages from msg_ids if the LLM used the new compact format
        const msgs: DigestMessage[] = (t.msg_ids || [])
          .map((id: string) => promptIdMap.get(id))
          .filter(Boolean) as DigestMessage[];
        // Graceful fallback: if old format with inline messages was returned, use it
        const inlineMsgs = (t.messages || []).map((m: any) => ({
          sender: m.sender || '',
          subject: m.subject,
          preview: m.preview || '',
          channel: m.channel || 'outlook',
          timestamp: m.timestamp,
          isUnread: m.isUnread ?? false,
        }));
        return {
          title: t.title || '',
          summary: t.summary || '',
          messages: msgs.length > 0 ? msgs : inlineMsgs,
          priority: t.priority || 'medium',
          addressing: t.addressing || 'unknown',
        };
      }),
      action_items: parsed.action_items || [],
      total_messages: messages.length,
      channels,
    };
  } catch (e) {
    console.error('[DigestService] LLM parse error:', e);
    // Fallback: group by sender
    const bySender = new Map<string, DigestMessage[]>();
    messages.forEach(m => {
      if (!bySender.has(m.sender)) bySender.set(m.sender, []);
      bySender.get(m.sender)!.push(m);
    });
    return {
      executive_summary: `Foram encontradas ${messages.length} comunicações de ${channels.join(' e ')}. Não foi possível gerar o resumo com IA — abaixo estão agrupadas por remetente.`,
      topics: Array.from(bySender.entries()).map(([sender, msgs]) => ({
        title: sender,
        summary: msgs.map(m => {
          const prefix = m.channel === 'outlook' ? `[Email: ${m.subject}]` : `[Teams: ${m.sender}]`;
          return `${prefix} ${m.preview}`;
        }).join('; '),
        messages: msgs.map(m => ({ sender: m.sender, subject: m.subject, preview: m.preview })),
        priority: 'medium' as const,
      })),
      action_items: [],
      total_messages: messages.length,
      channels,
    };
  }
}

/**
 * Save a digest to the database.
 */
export function saveDigest(db: any, date: string, channel: string, summary: DigestSummary, rawMessages: DigestMessage[]): string {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO CommunicationDigest (id, digest_date, channel, total_messages, summary_json, raw_messages_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, date, channel, summary.total_messages, JSON.stringify(summary), JSON.stringify(rawMessages));
  return id;
}

/** List digests ordered by date desc. */
export function listDigests(db: any, limit = 30): any[] {
  return db.prepare(`
    SELECT id, digest_date, channel, total_messages, summary_json, generated_at
    FROM CommunicationDigest ORDER BY digest_date DESC, generated_at DESC LIMIT ?
  `).all(limit);
}

/** Get full digest by id. */
export function getDigestDetails(db: any, digestId: string): any | null {
  return db.prepare('SELECT * FROM CommunicationDigest WHERE id = ?').get(digestId) || null;
}

/** Get digest by date. */
export function getDigestByDate(db: any, date: string): any | null {
  return db.prepare('SELECT * FROM CommunicationDigest WHERE digest_date = ? ORDER BY generated_at DESC LIMIT 1').get(date) || null;
}

/** Delete a digest. */
export function deleteDigest(db: any, digestId: string): boolean {
  return db.prepare('DELETE FROM CommunicationDigest WHERE id = ?').run(digestId).changes > 0;
}

/**
 * Search digests by text query, channel, and/or date filter.
 * Supports: 'today', 'yesterday', 'this_week', 'last_week', 'YYYY-MM-DD'
 */
export function searchDigestMemory(
  db: any,
  query: string | {
    query?: string;
    channel?: string;
    date_filter?: string;
  },
  limit = 5,
): any[] {
  const cols = `id, digest_date, channel, total_messages, summary_json, generated_at`;

  if (typeof query === 'string') {
    return db.prepare(`
      SELECT ${cols} FROM CommunicationDigest
      WHERE summary_json LIKE ?
      ORDER BY digest_date DESC, generated_at DESC
      LIMIT ?
    `).all(`%${query}%`, limit);
  }

  const conditions: string[] = [];
  const params: any[] = [];

  if (query.query) {
    conditions.push(`summary_json LIKE ?`);
    params.push(`%${query.query}%`);
  }

  if (query.channel && query.channel !== 'all') {
    conditions.push(`channel = ?`);
    params.push(query.channel);
  }

  if (query.date_filter) {
    if (query.date_filter === 'today') {
      conditions.push(`date(digest_date) = date('now', 'localtime')`);
    } else if (query.date_filter === 'yesterday') {
      conditions.push(`date(digest_date) = date('now', '-1 days', 'localtime')`);
    } else if (query.date_filter === 'this_week') {
      conditions.push(`date(digest_date) >= date('now', '-7 days', 'localtime')`);
    } else if (query.date_filter === 'last_week') {
      conditions.push(`date(digest_date) >= date('now', '-14 days', 'localtime') AND date(digest_date) < date('now', '-7 days', 'localtime')`);
    } else {
      // Specific date YYYY-MM-DD
      conditions.push(`date(digest_date) = ?`);
      params.push(query.date_filter);
    }
  }

  let sql = `SELECT ${cols} FROM CommunicationDigest`;
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY digest_date DESC, generated_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

