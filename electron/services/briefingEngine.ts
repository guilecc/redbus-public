/**
 * BriefingEngine — Generates executive briefings from the Unified Inbox.
 *
 * Flow:
 * 1. extractAll() from channelManager → UnifiedMessage[]
 * 2. Send JSON to Worker LLM with urgency classification prompt
 * 3. Generate structured briefing text
 * 4. Emit IPC to renderer + OS notification
 * 5. Optionally generate draft replies for urgent messages
 */

import { v4 as uuidv4 } from 'uuid';
import { extractAll, getCachedMessages, injectDraftReply } from './channelManager';
import { fetchWithTimeout, callOllamaChat } from './llmService';
import { sendOSNotification } from './notificationService';
import { saveMessage } from './archiveService';
import { logActivity } from './activityLogger';
import { BrowserWindow } from 'electron';
import type { UnifiedMessage, BriefingResult, ChannelId } from './extractors/types';

/* ── Configuration ── */

let _db: any = null;
let _mainWindow: BrowserWindow | null = null;

const BRIEFING_SYSTEM_PROMPT = `You are the executive assistant of the Director of Operations. You receive a JSON array of unread messages from Outlook 365 and Microsoft Teams.

Your tasks:
1. Classify each message's urgency as "low", "medium", or "high" based on:
   - HIGH: Direct requests from superiors, CEO, clients, production incidents, deadlines within 24h
   - MEDIUM: Team coordination, meeting follow-ups, project updates requiring attention
   - LOW: FYI messages, newsletters, casual conversation, non-urgent internal comms
2. Generate a concise executive briefing in the user's language (Portuguese).

Respond ONLY with valid JSON:
{
  "messages": [
    { "channel": "outlook|teams", "sender": "Name", "subject": "...", "preview": "...", "urgency": "low|medium|high" }
  ],
  "briefing": "Você tem X mensagens. Y urgentes: [lista]. O restante trata de [resumo]."
}`;

const DRAFT_REPLY_SYSTEM_PROMPT = `You are the executive assistant of the Director of Operations. You need to draft SHORT, professional reply messages (max 2 sentences each) for urgent messages.
Use the same language as the original message.
Be direct, professional, and action-oriented.

Respond ONLY with valid JSON:
{
  "drafts": [
    { "channel": "outlook|teams", "sender": "Name", "draft": "Short reply text" }
  ]
}`;

/* ── Initialization ── */

export function initBriefingEngine(db: any, mainWindow: BrowserWindow): void {
  _db = db;
  _mainWindow = mainWindow;
}

/* ── LLM Call ── */

async function callWorkerLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!_db) throw new Error('DB not initialized');

  const configs = _db.prepare('SELECT * FROM ProviderConfigs WHERE id = 1').get();
  if (!configs) throw new Error('No ProviderConfigs found');

  const model = configs.workerModel || 'gemini-2.5-flash';

  if (model.includes('gemini') && configs.googleKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${configs.googleKey}`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }, 30_000);
    if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
    const d = await res.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (model.includes('claude') && configs.anthropicKey) {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': configs.anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }, 30_000);
    if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);
    const d = await res.json();
    return d.content?.[0]?.text || '';
  }

  if ((model.includes('gpt') || model.includes('o1') || model.includes('o3')) && configs.openAiKey) {
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${configs.openAiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    }, 30_000);
    if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
    const d = await res.json();
    return d.choices?.[0]?.message?.content || '';
  }

  if (model.startsWith('ollama/') || model.startsWith('ollama-cloud/')) {
    const isCloud = model.startsWith('ollama-cloud/');
    const targetUrl = isCloud ? (configs.ollamaCloudUrl || 'https://ollama.com') : (configs.ollamaUrl || 'http://localhost:11434');
    const cleanModel = model.replace('ollama/', '').replace('ollama-cloud/', '');
    const authHeaders = isCloud && configs.ollamaCloudKey ? { 'Authorization': `Bearer ${configs.ollamaCloudKey}` } : undefined;
    const d = await callOllamaChat(targetUrl, cleanModel, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { headers: authHeaders, response_format: { type: 'json_object' } });
    return d.choices?.[0]?.message?.content || '';
  }

  throw new Error(`Unsupported worker model for briefing: ${model}`);
}

/* ── JSON Parser ── */

function parseJSON(raw: string): any {
  try {
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    console.warn('[BriefingEngine] Failed to parse LLM response JSON');
    return null;
  }
}

/* ── Briefing Generation ── */

/**
 * Trigger a full briefing cycle:
 * 1. Extract unread messages from all connected channels.
 * 2. Send to LLM for urgency classification.
 * 3. Build a structured briefing.
 * 4. Emit to renderer + OS notification.
 */
export async function generateBriefing(forceExtract: boolean = true): Promise<BriefingResult> {
  console.log('[BriefingEngine] Generating briefing...');
  logActivity('inbox', 'Gerando briefing executivo...');

  // Step 1: Extract or use cached messages
  const messages = forceExtract ? await extractAll() : getCachedMessages();

  if (messages.length === 0) {
    const emptyResult: BriefingResult = {
      generatedAt: new Date().toISOString(),
      totalMessages: 0,
      urgentCount: 0,
      briefingText: 'Nenhuma mensagem não lida nos canais conectados.',
      messages: [],
    };
    _emitBriefing(emptyResult);
    return emptyResult;
  }

  // Step 2: Send to LLM for classification
  try {
    const userPrompt = `Here are ${messages.length} unread messages:\n${JSON.stringify(messages, null, 2)}`;
    const raw = await callWorkerLLM(BRIEFING_SYSTEM_PROMPT, userPrompt);
    const parsed = parseJSON(raw);

    if (!parsed) {
      // Fallback: return unclassified messages
      const fallbackResult: BriefingResult = {
        generatedAt: new Date().toISOString(),
        totalMessages: messages.length,
        urgentCount: 0,
        briefingText: `Você tem ${messages.length} mensagens não lidas. Não foi possível classificar a urgência.`,
        messages,
      };
      _emitBriefing(fallbackResult);
      return fallbackResult;
    }

    // Merge urgency classifications back into messages
    const classifiedMessages: UnifiedMessage[] = messages.map(msg => {
      const classified = (parsed.messages || []).find((m: any) =>
        m.sender === msg.sender && m.channel === msg.channel
      );
      return {
        ...msg,
        urgency: classified?.urgency || 'unknown',
      };
    });

    const urgentCount = classifiedMessages.filter(m => m.urgency === 'high').length;

    const result: BriefingResult = {
      generatedAt: new Date().toISOString(),
      totalMessages: classifiedMessages.length,
      urgentCount,
      briefingText: parsed.briefing || `Você tem ${classifiedMessages.length} mensagens. ${urgentCount} urgentes.`,
      messages: classifiedMessages,
    };

    _emitBriefing(result);
    logActivity('inbox', `Briefing gerado: ${result.totalMessages} mensagens, ${urgentCount} urgentes`);

    return result;
  } catch (err) {
    console.error('[BriefingEngine] LLM call failed:', err);
    const errorResult: BriefingResult = {
      generatedAt: new Date().toISOString(),
      totalMessages: messages.length,
      urgentCount: 0,
      briefingText: `Você tem ${messages.length} mensagens não lidas. Erro ao classificar: ${String(err)}`,
      messages,
    };
    _emitBriefing(errorResult);
    return errorResult;
  }
}

/* ── Draft Reply Generation ── */

/**
 * Generate draft replies for urgent messages and optionally inject them.
 */
export async function generateDraftReplies(messages?: UnifiedMessage[]): Promise<Array<{ channel: ChannelId; sender: string; draft: string }>> {
  const urgentMessages = (messages || getCachedMessages()).filter(m => m.urgency === 'high');

  if (urgentMessages.length === 0) {
    console.log('[BriefingEngine] No urgent messages to draft replies for');
    return [];
  }

  try {
    const userPrompt = `Draft replies for these urgent messages:\n${JSON.stringify(urgentMessages, null, 2)}`;
    const raw = await callWorkerLLM(DRAFT_REPLY_SYSTEM_PROMPT, userPrompt);
    const parsed = parseJSON(raw);

    if (!parsed?.drafts) return [];

    const drafts: Array<{ channel: ChannelId; sender: string; draft: string }> = parsed.drafts;

    logActivity('inbox', `${drafts.length} rascunhos de resposta gerados`);

    // Emit drafts to renderer
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('inbox:drafts-ready', { drafts });
    }

    return drafts;
  } catch (err) {
    console.error('[BriefingEngine] Draft generation failed:', err);
    return [];
  }
}

/**
 * Inject a specific draft reply into the target channel.
 */
export async function injectDraft(channelId: ChannelId, sender: string, draftText: string): Promise<{ success: boolean; error?: string }> {
  return injectDraftReply(channelId, sender, draftText);
}

/* ── Internal Helpers ── */

function _emitBriefing(result: BriefingResult): void {
  // Save briefing as a chat message
  if (_db) {
    const msgId = uuidv4();
    saveMessage(_db, {
      id: msgId,
      role: 'assistant',
      content: result.briefingText,
      type: 'proactive',
    });

    // Also emit to chat
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('chat:new-message', {
        id: msgId,
        role: 'assistant',
        content: result.briefingText,
        type: 'proactive',
      });
    }
  }

  // Emit full briefing data to inbox UI
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('inbox:briefing-ready', result);
  }

  // OS notification
  sendOSNotification('RedBus — Inbox Executiva', result.briefingText.slice(0, 120));
}

/* ── Test helpers ── */
export function _resetBriefingEngine(): void {
  _db = null;
  _mainWindow = null;
}
