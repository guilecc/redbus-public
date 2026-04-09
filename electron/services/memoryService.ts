import { fetchWithTimeout } from './llmService';
import {
  countUncompactedMessages,
  getUncompactedMessages,
  markMessagesAsCompacted,
  getConversationSummary,
  updateConversationSummary,
  type ChatMessage
} from './archiveService';
import { syncFtsIndex } from './memorySearchService';
import { v4 as uuidv4 } from 'uuid';

// ── Configuration ──
const COMPACTION_THRESHOLD = 20;
const MESSAGES_TO_COMPACT = 15;
const MAX_SUMMARY_TOKENS = 3000; // rough estimate: 1 token ≈ 4 chars
const MAX_SUMMARY_CHARS = MAX_SUMMARY_TOKENS * 4;

/**
 * Rough token estimate (1 token ≈ 4 chars for English, ~2 for PT).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

// Added import for aaakService
import { processMessagesIntoMempalace } from './aaakService';

/**
 * Check if compaction is needed and run it in background.
 * Now also extracts facts into MemPalace Architecture.
 */
export async function compactHistoryIfNeeded(db: any): Promise<void> {
  try {
    const uncompactedCount = countUncompactedMessages(db);
    if (uncompactedCount < COMPACTION_THRESHOLD) return;

    const oldestMessages = getUncompactedMessages(db, MESSAGES_TO_COMPACT);
    if (oldestMessages.length === 0) return;

    const currentSummary = getConversationSummary(db);

    // Run compaction + MemPalace Wing/Room AAAK extraction in parallel
    const [newSummary] = await Promise.all([
      generateCompactedSummary(db, currentSummary, oldestMessages),
      processMessagesIntoMempalace(db, oldestMessages).catch((e: any) => {
        console.error('[MemoryService] MemPalace extraction failed (non-fatal):', e);
      }),
    ]);

    // Cap summary if it's getting too long
    let finalSummary = newSummary;
    const tokenEst = estimateTokens(newSummary);
    if (tokenEst > MAX_SUMMARY_TOKENS) {
      console.log(`[MemoryService] Summary too large (~${tokenEst} tokens), re-compacting...`);
      finalSummary = await recompactSummary(db, newSummary);
    }

    // Atomic: update summary + mark messages as compacted
    updateConversationSummary(db, finalSummary);
    db.prepare(`
      UPDATE ConversationSummary
      SET token_estimate = ?, generation_count = generation_count + 1
      WHERE id = 1
    `).run(estimateTokens(finalSummary));
    markMessagesAsCompacted(db, oldestMessages.map(m => m.id));

    // Sync FTS index with new messages
    syncFtsIndex(db);

    console.log(`[MemoryService] Compacted ${oldestMessages.length} msgs into MemPalace. Summary ~${estimateTokens(finalSummary)} tokens.`);
  } catch (e) {
    console.error('[MemoryService] Compaction failed (non-fatal):', e);
  }
}


/* ═══════════════════════════════════════════════
   Worker LLM helper — reusable across all memory tasks
   ═══════════════════════════════════════════════ */

export async function callWorkerLLM(db: any, systemPrompt: string, userPrompt: string): Promise<string> {
  const configs = db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
  if (!configs) throw new Error('Provider configs not found');
  const model = configs.workerModel || 'gemini-2.5-flash';

  if (model.includes('gemini')) {
    if (!configs.googleKey) throw new Error('Google API Key missing');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${configs.googleKey}`;
    const r = await fetchWithTimeout(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
      }),
    });
    if (!r.ok) throw new Error(`Gemini error: ${await r.text()}`);
    const d = await r.json();
    return d.candidates[0].content.parts[0].text.trim();
  }

  if (model.includes('claude')) {
    if (!configs.anthropicKey) throw new Error('Anthropic API Key missing');
    const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': configs.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2048, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    });
    if (!r.ok) throw new Error(`Anthropic error: ${await r.text()}`);
    const d = await r.json();
    return d.content[0].text.trim();
  }

  if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) {
    if (!configs.openAiKey) throw new Error('OpenAI API Key missing');
    const r = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${configs.openAiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }),
    });
    if (!r.ok) throw new Error(`OpenAI error: ${await r.text()}`);
    const d = await r.json();
    return d.choices[0].message.content.trim();
  }

  throw new Error(`Unsupported worker model: ${model}`);
}

/* ═══════════════════════════════════════════════
   Summary generation
   ═══════════════════════════════════════════════ */

function formatMessagesForLLM(messages: ChatMessage[]): string {
  return messages
    .map(m => `[${m.role.toUpperCase()}]: ${m.content || (m.type === 'spec' ? `[Living Spec: ${m.specData || ''}]` : '')}`)
    .join('\n');
}

export async function generateCompactedSummary(
  db: any, currentSummary: string, messages: ChatMessage[],
): Promise<string> {
  const messagesText = formatMessagesForLLM(messages);

  const systemPrompt = `You are a memory compaction engine. Produce an extremely dense, factual summary preserving ALL important context for future AI interactions.
Rules:
- Integrate new messages into existing summary seamlessly.
- Preserve: user preferences, decisions, facts, tasks completed/pending, names, dates, URLs.
- Remove: greetings, filler, redundant back-and-forth.
- Be extremely concise. Every word must carry information.
- Output ONLY the updated summary text. No headers, no markdown.
- Write in the same language the user uses.`;

  const userPrompt = currentSummary
    ? `EXISTING SUMMARY:\n${currentSummary}\n\nNEW MESSAGES TO INTEGRATE:\n${messagesText}`
    : `NEW MESSAGES TO SUMMARIZE:\n${messagesText}`;

  return callWorkerLLM(db, systemPrompt, userPrompt);
}

/* ═══════════════════════════════════════════════
   Re-compaction — shrink a summary that's too large
   ═══════════════════════════════════════════════ */

async function recompactSummary(db: any, summary: string): Promise<string> {
  const systemPrompt = `You are a summary compression engine. Take the provided summary and compress it to roughly HALF its current length while preserving all critical facts, decisions, and context.
Rules:
- Keep: names, URLs, dates, key decisions, user preferences, pending tasks.
- Remove: redundant descriptions, verbose explanations, anything that can be inferred.
- Output ONLY the compressed summary text.`;

  return callWorkerLLM(db, systemPrompt, `SUMMARY TO COMPRESS:\n${summary}`);
}

/* ═══════════════════════════════════════════════
   Fact extraction from messages
   ═══════════════════════════════════════════════ */

export async function extractFactsFromMessages(
  db: any, messages: ChatMessage[],
): Promise<Array<{ category: string; content: string }>> {
  const messagesText = formatMessagesForLLM(messages);

  const systemPrompt = `You are a fact extraction engine. From the conversation messages, extract discrete, reusable facts.
Categories: "preference" (user likes/dislikes), "entity" (names, URLs, services), "decision" (choices made), "pattern" (recurring behaviors), "credential" (service names, API endpoints — NEVER extract actual passwords/tokens).

Output a JSON array of objects: [{"category": "...", "content": "..."}]
Each fact should be a single dense sentence. Extract 0-8 facts. If nothing notable, return [].
Output ONLY the JSON array, nothing else.`;

  const raw = await callWorkerLLM(db, systemPrompt, `MESSAGES:\n${messagesText}`);

  try {
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f: any) => f.category && f.content && typeof f.content === 'string');
  } catch {
    console.warn('[MemoryService] Failed to parse fact extraction response');
    return [];
  }
}

/* ═══════════════════════════════════════════════
   Public helpers for other services to save facts
   ═══════════════════════════════════════════════ */

/**
 * Save a fact from a Forge skill creation event.
 */
export function saveFactFromForge(db: any, skillName: string, description: string): void {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO MemoryFacts (id, category, content, source, confidence)
      VALUES (?, 'forge', ?, 'forge', 1.0)
    `).run(uuidv4(), `Skill "${skillName}" foi forjada: ${description}`);

    const safeWing = 'system_forge';
    db.prepare(`INSERT OR IGNORE INTO MP_Wings (id, name, type) VALUES (?, 'System Forge', 'topic')`).run(safeWing);
    const safeRoom = safeWing + '_skills';
    db.prepare(`INSERT OR IGNORE INTO MP_Rooms (id, wing_id, name) VALUES (?, ?, 'Created Skills')`).run(safeRoom, safeWing);
    db.prepare(`INSERT INTO MP_Closets (id, room_id, hall_type, aaak_content) VALUES (?, ?, 'hall_events', ?)`).run(uuidv4(), safeRoom, `FORGE: SKILL|${skillName}|FORGED (${description})`);
  } catch (e) {
    console.error('[MemoryService] saveFactFromForge error:', e);
  }
}

/**
 * Save a fact from a routine execution result.
 */
export function saveFactFromRoutine(db: any, goal: string, summary: string): void {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO MemoryFacts (id, category, content, source, confidence)
      VALUES (?, 'pattern', ?, 'routine', 0.8)
    `).run(uuidv4(), `Rotina "${goal}": ${summary}`);

    const safeWing = 'system_routines';
    db.prepare(`INSERT OR IGNORE INTO MP_Wings (id, name, type) VALUES (?, 'System Routines', 'topic')`).run(safeWing);
    const safeRoom = safeWing + '_execs';
    db.prepare(`INSERT OR IGNORE INTO MP_Rooms (id, wing_id, name) VALUES (?, ?, 'Routine Executions')`).run(safeRoom, safeWing);
    db.prepare(`INSERT INTO MP_Closets (id, room_id, hall_type, aaak_content) VALUES (?, ?, 'hall_events', ?)`).run(uuidv4(), safeRoom, `ROUTINE: EXEC|${goal}|${summary}`);
  } catch (e) {
    console.error('[MemoryService] saveFactFromRoutine error:', e);
  }
}

/**
 * Get all active (non-superseded) facts for context building.
 */
export function getActiveFacts(db: any, limit = 30): Array<{ id: string; category: string; content: string }> {
  try {
    // Legacy Facts
    const legacy = db.prepare(`
      SELECT id, category, content FROM MemoryFacts
      WHERE supersededBy IS NULL
      ORDER BY lastReferencedAt DESC, createdAt DESC
      LIMIT ?
    `).all(limit) as any[];

    // MemPalace Closets
    const closets = db.prepare(`
      SELECT id, hall_type as category, aaak_content as content FROM MP_Closets
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return [...closets, ...legacy].slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Mark facts as "referenced" (used in context) to boost their relevance.
 */
export function touchFacts(db: any, factIds: string[]): void {
  if (factIds.length === 0) return;
  try {
    const placeholders = factIds.map(() => '?').join(',');
    db.prepare(`UPDATE MemoryFacts SET lastReferencedAt = datetime('now') WHERE id IN (${placeholders})`).run(...factIds);
    db.prepare(`UPDATE MP_Closets SET updated_at = datetime('now') WHERE id IN (${placeholders})`).run(...factIds);
  } catch (e) {
    console.error('[MemoryService] touchFacts error:', e);
  }
}
