/**
 * IntelligentExtractor — MCP-like LLM-controlled browser navigator.
 *
 * Instead of passively capturing a DOM snapshot and parsing it,
 * this module gives the LLM full control over Playwright via tool-calling.
 * The LLM actively navigates, clicks, scrolls, and extracts data
 * from Outlook and Teams — adapting to whatever layout it finds.
 *
 * Architecture:
 *   LLM Worker ←→ Tool Loop ←→ Playwright (headless Chromium)
 *       ↓                            ↓
 *   "click inbox"              page.click(selector)
 *   "scroll down"              page.keyboard.press('PageDown')
 *   "extract messages"         commit_extracted_data({messages: [...]})
 */

import type { ChannelId, UnifiedMessage } from './extractors/types';
import { browseOpen, browseSnapshot, browseClick, browseType, browsePressKey, browseClose } from './playwrightService';
import { runWorkerStep } from './llmService';

const MAX_STEPS = 20;

function _getSystemPrompt(channelId: ChannelId, targetDate?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const dateStr = targetDate || today;
  const isToday = dateStr === today;
  const dateInstruction = isToday
    ? `Today is ${dateStr}. Extract messages from TODAY.`
    : `Today is ${today}. You must extract messages from the date ${dateStr}. You may need to scroll or navigate to find messages from that specific date. If the inbox only shows recent messages, scroll down or use date filters/search to find messages from ${dateStr}.`;

  const refExplanation = `
SNAPSHOT FORMAT:
The page snapshot is an accessibility tree. Interactive elements have [ref=eN] markers.
Use these refs with tools: browser_click(ref="e5"), browser_type(ref="e3", text="hello").
Example snapshot:
  - navigation "Main":
    - link "Inbox" [ref=e1]
    - link "Sent" [ref=e2]
  - main:
    - listitem:
      - link "John Doe - Meeting tomorrow" [ref=e3]
To click "Inbox", call browser_click with ref="e1".`;

  if (channelId === 'outlook') {
    return `You are an intelligent browser agent extracting emails from Microsoft Outlook Web.
${dateInstruction}
You are already authenticated.
${refExplanation}

YOUR MISSION:
1. You see an accessibility tree snapshot of the Outlook inbox
2. Navigate to find emails from ${dateStr}
3. Extract message details from what you see in the tree
4. Call commit_extracted_data with: { "messages": [...] }

Each message: { "channel": "outlook", "sender": "Name", "subject": "Subject", "preview": "Body preview", "timestamp": "ISO 8601 or null", "urgency": "unknown", "isUnread": true/false }

NAVIGATION:
- The inbox list shows emails as listitem/link/treeitem elements
- Sender, subject, and preview are in the element names/text
- Use browser_scroll_down to see more emails
- Use browser_click(ref="eN") to click sidebar items like "Focused", "Other"
${!isToday ? `- For ${dateStr}: scroll down or look for date separators in the list` : ''}

CRITICAL RULES:
- You MUST call commit_extracted_data tool with the extracted messages. NEVER respond with plain text.
- Do NOT click individual emails — extract from the list view
- If you see a login form, commit empty messages: { "messages": [] }
- Be efficient — extract what's visible and commit immediately
- Max ${MAX_STEPS} steps
- ALWAYS use tools. Your ONLY valid final action is commit_extracted_data.`;
  }

  return `You are an intelligent browser agent extracting messages from Microsoft Teams.
${dateInstruction}
You are already authenticated.
${refExplanation}

YOUR MISSION:
1. You see an accessibility tree snapshot of Teams
2. Navigate to find chats/activity from ${dateStr}
3. Extract message details from the tree
4. Call commit_extracted_data with: { "messages": [...] }

Each message: { "channel": "teams", "sender": "Name", "preview": "Message text", "timestamp": "ISO 8601 or null", "urgency": "unknown", "isUnread": true/false }

NAVIGATION:
- Teams has a sidebar: Chat, Activity, Teams sections
- Click "Chat" [ref=eN] or "Activity" [ref=eN] to navigate
- Chat list shows conversations as listitem elements
- Activity feed shows mentions and replies
- Use browser_scroll_down to see more items
${!isToday ? `- For ${dateStr}: scroll the list to find messages from that date` : ''}

CRITICAL RULES:
- You MUST call commit_extracted_data tool with the extracted messages. NEVER respond with plain text.
- Extract from the list view, don't open individual chats
- If you see a login/error page, commit empty messages: { "messages": [] }
- Be efficient — extract and commit immediately
- Max ${MAX_STEPS} steps
- ALWAYS use tools. Your ONLY valid final action is commit_extracted_data.`;
}

/**
 * Run the intelligent extractor for a channel.
 * Opens a Playwright page, gives the LLM control via tool-calling,
 * and returns the extracted messages.
 */
export async function intelligentExtract(db: any, channelId: ChannelId, url: string, targetDate?: string): Promise<UnifiedMessage[]> {
  const sessionId = `inbox_${channelId}_${Date.now()}`;
  const dateLabel = targetDate || new Date().toISOString().slice(0, 10);

  try {
    console.log(`[IntelligentExtractor] 🧠 Starting for ${channelId} (date: ${dateLabel}): ${url}`);
    await browseOpen(url, sessionId);

    const initialSnapshot = await browseSnapshot(sessionId);
    console.log(`[IntelligentExtractor] 📸 Initial snapshot: ${initialSnapshot.length} chars`);

    const messages: any[] = [{
      role: 'user',
      content: `${_getSystemPrompt(channelId, targetDate)}\n\nCurrent page snapshot:\n${initialSnapshot.substring(0, 20000)}\n\nNavigate and extract messages from ${dateLabel}. Call commit_extracted_data when done.`
    }];

    let stepCount = 0;
    let extractedMessages: UnifiedMessage[] = [];

    while (stepCount < MAX_STEPS) {
      stepCount++;
      console.log(`[IntelligentExtractor] Step ${stepCount}/${MAX_STEPS} for ${channelId}`);

      const response = await runWorkerStep(db, messages);

      if (!response.tool_calls) {
        // LLM responded with text instead of tool call — push it back and insist on tool use
        console.log(`[IntelligentExtractor] LLM text (no tool), retrying: ${(response.content || '').substring(0, 200)}`);
        messages.push({ role: 'assistant', content: response.content || '' });
        messages.push({
          role: 'user',
          content: `You MUST call the commit_extracted_data tool now. Extract the messages you can see from the snapshot and commit them as JSON: { "messages": [...] }. Each message needs: channel, sender, subject (for outlook), preview, timestamp, urgency, isUnread. If you see no messages, commit: { "messages": [] }. Do NOT respond with text — use the tool.`
        });
        continue;
      }

      const toolCall = response.tool_calls[0];
      messages.push({ role: 'assistant', content: response.content || `Calling ${toolCall.name}` });

      let toolOutput = '';

      if (toolCall.name === 'commit_extracted_data') {
        const data = toolCall.args.data;
        extractedMessages = _parseCommittedData(channelId, data);
        console.log(`[IntelligentExtractor] ✅ ${channelId}: committed ${extractedMessages.length} messages`);
        break;
      }

      toolOutput = await _executeTool(sessionId, toolCall);
      messages.push({ role: 'user', content: toolOutput });
    }

    if (stepCount >= MAX_STEPS && extractedMessages.length === 0) {
      console.warn(`[IntelligentExtractor] ⚠ ${channelId}: hit max steps without extracting`);
    }

    return extractedMessages;
  } catch (err) {
    console.error(`[IntelligentExtractor] ❌ ${channelId} error:`, err);
    return [];
  } finally {
    await browseClose(sessionId);
  }
}

/* ── Tool Execution ── */

async function _executeTool(sessionId: string, toolCall: { name: string; args: any }): Promise<string> {
  try {
    switch (toolCall.name) {
      case 'browser_snapshot': {
        const snap = await browseSnapshot(sessionId);
        return `Page snapshot:\n${snap.substring(0, 20000)}`;
      }
      case 'browser_click': {
        const result = await browseClick(sessionId, toolCall.args.ref);
        const snap = await browseSnapshot(sessionId);
        return `${result}.\nNew snapshot:\n${snap.substring(0, 20000)}`;
      }
      case 'browser_type': {
        const result = await browseType(sessionId, toolCall.args.text, toolCall.args.ref);
        if (toolCall.args.submit) await browsePressKey(sessionId, 'Enter');
        const snap = await browseSnapshot(sessionId);
        return `${result}.\nNew snapshot:\n${snap.substring(0, 20000)}`;
      }
      case 'browser_press_key': {
        await browsePressKey(sessionId, toolCall.args.key);
        const snap = await browseSnapshot(sessionId);
        return `Pressed ${toolCall.args.key}.\nNew snapshot:\n${snap.substring(0, 20000)}`;
      }
      case 'browser_scroll_down': {
        await browsePressKey(sessionId, 'PageDown');
        const snap = await browseSnapshot(sessionId);
        return `Scrolled down.\nNew snapshot:\n${snap.substring(0, 20000)}`;
      }
      case 'browser_scroll_up': {
        await browsePressKey(sessionId, 'PageUp');
        const snap = await browseSnapshot(sessionId);
        return `Scrolled up.\nNew snapshot:\n${snap.substring(0, 20000)}`;
      }
      case 'request_user_authentication':
        return 'Authentication not available in headless mode. Commit empty messages if on a login page.';
      default:
        return `Unknown tool "${toolCall.name}". Available: browser_snapshot, browser_click, browser_type, browser_press_key, browser_scroll_down, browser_scroll_up, commit_extracted_data.`;
    }
  } catch (err) {
    return `[ERROR] Tool ${toolCall.name} failed: ${err}`;
  }
}

/* ── Data Parsing ── */

function _parseCommittedData(channelId: ChannelId, data: any): UnifiedMessage[] {
  try {
    let msgs: any[] = [];
    if (Array.isArray(data)) msgs = data;
    else if (data?.messages && Array.isArray(data.messages)) msgs = data.messages;
    else if (typeof data === 'string') {
      const parsed = JSON.parse(data);
      msgs = Array.isArray(parsed) ? parsed : parsed?.messages || [];
    } else return [];

    return msgs.map((m: any) => ({
      channel: channelId,
      sender: m.sender || 'Unknown',
      subject: m.subject,
      preview: m.preview || '',
      timestamp: m.timestamp || null,
      urgency: m.urgency || 'unknown',
      isUnread: m.isUnread ?? true,
    }));
  } catch (err) {
    console.error(`[IntelligentExtractor] Parse error:`, err);
    return [];
  }
}
