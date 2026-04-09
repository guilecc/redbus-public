/**
 * DigestService — generates daily communication digests from channel messages.
 * Extracts messages → groups by topic → LLM summarizes → saves to CommunicationDigest table.
 */
import { v4 as uuidv4 } from 'uuid';

export interface DigestMessage {
  channel: string;
  sender: string;
  subject?: string;
  preview: string;
  timestamp?: string | null;
  isUnread?: boolean;
}

export interface DigestTopic {
  title: string;
  summary: string;
  messages: Array<{ sender: string; subject?: string; preview: string }>;
  priority: 'high' | 'medium' | 'low';
}

export interface DigestSummary {
  executive_summary: string;
  topics: DigestTopic[];
  action_items: string[];
  total_messages: number;
  channels: string[];
}

/**
 * Generate a digest from extracted messages using LLM.
 */
export async function generateDigestFromMessages(
  messages: DigestMessage[],
  callLLM: (prompt: string) => Promise<string>,
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

  let messagesBlock = '';
  if (outlookMsgs.length > 0) {
    messagesBlock += '=== EMAILS (Outlook) ===\n';
    messagesBlock += outlookMsgs.map((m, i) =>
      `${i + 1}. De: ${m.sender}${m.subject ? `\n   Assunto: ${m.subject}` : ''}${m.isUnread ? ' [NÃO LIDO]' : ''}\n   ${m.preview}`
    ).join('\n\n');
  }
  if (teamsMsgs.length > 0) {
    messagesBlock += '\n\n=== MENSAGENS (Teams) ===\n';
    messagesBlock += teamsMsgs.map((m, i) =>
      `${i + 1}. De: ${m.sender}${m.isUnread ? ' [NÃO LIDO]' : ''}\n   ${m.preview}`
    ).join('\n\n');
  }
  // Include any other channels
  const otherMsgs = messages.filter(m => m.channel !== 'outlook' && m.channel !== 'teams');
  if (otherMsgs.length > 0) {
    messagesBlock += '\n\n=== OUTRAS MENSAGENS ===\n';
    messagesBlock += otherMsgs.map((m, i) =>
      `${i + 1}. [${m.channel}] De: ${m.sender}\n   ${m.preview}`
    ).join('\n\n');
  }

  const prompt = `Você é um assistente executivo pessoal. Sua tarefa é analisar os emails e mensagens do dia e produzir um briefing diário claro e acionável.

${messagesBlock}

---

Com base nas comunicações acima, produza um briefing executivo em JSON. Siga estas regras:

1. **Resumo executivo**: 2-4 frases descrevendo o panorama do dia. O que está acontecendo? O que precisa de atenção? Escreva como se estivesse falando diretamente com o executivo.

2. **Tópicos**: Agrupe as mensagens por projeto, assunto ou tema de conversa. Cada tópico deve ter:
   - Um título claro (nome do projeto, assunto, ou tema)
   - Um resumo explicando o contexto e o que está acontecendo
   - As mensagens originais que pertencem a esse tópico
   - Prioridade: "high" (requer decisão/ação urgente), "medium" (importante mas não urgente), "low" (informativo/FYI)

3. **Itens de ação**: Liste ações concretas que o executivo precisa tomar, extraídas das mensagens. Seja específico (ex: "Responder ao João sobre o orçamento do projeto X" em vez de "Responder emails").

Retorne APENAS um JSON válido (sem markdown, sem \`\`\`) com esta estrutura exata:
{
  "executive_summary": "...",
  "topics": [
    {
      "title": "Nome do tópico/projeto",
      "summary": "O que está acontecendo neste tópico",
      "messages": [{"sender": "Nome", "subject": "Assunto se houver", "preview": "Conteúdo resumido"}],
      "priority": "high|medium|low"
    }
  ],
  "action_items": ["Ação concreta 1", "Ação concreta 2"]
}

Responda em português. Ordene os tópicos por prioridade (high primeiro).`;

  try {
    const response = await callLLM(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in LLM response');
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      executive_summary: parsed.executive_summary || '',
      topics: (parsed.topics || []).map((t: any) => ({
        title: t.title || '',
        summary: t.summary || '',
        messages: t.messages || [],
        priority: t.priority || 'medium',
      })),
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
        summary: msgs.map(m => m.subject || m.preview).join('; '),
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

