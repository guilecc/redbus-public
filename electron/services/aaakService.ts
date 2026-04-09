import { v4 as uuidv4 } from 'uuid';
import { callWorkerLLM } from './memoryService';
import type { ChatMessage } from './archiveService';

const AAAK_SYSTEM_PROMPT = `
You are a MemPalace AAAK compression engine.
Your task is to take a conversation transcript and compress the facts into the AAAK shorthand dialect, which provides 30x lossless compression for AI memory.

Categories (halls) to use: "hall_facts" (decisions made), "hall_events" (milestones), "hall_discoveries" (new insights), "hall_preferences" (opinions), "hall_advice" (recommendations).

Identify the "wing" (the project or person this is about) and the "room" (the specific topic/feature).

Output ONLY a JSON array of objects representing the closets to save.
Structure:
[
  {
    "wing": "Project/Person Name",
    "wing_type": "project" | "person" | "topic",
    "room": "Topic/Feature Name",
    "hall_type": "hall_facts" | "hall_events" | "hall_discoveries" | "hall_preferences" | "hall_advice",
    "aaak_content": "The AAAK formatted dense fact. e.g. TEAM: PRI(lead) | DECISION: KAI.rec:clerk>auth0(pricing+dx) | ★★★★",
    "triples": [
      { "subject": "Name", "relation": "runs", "object": "thing" }
    ]
  }
]

Rules for AAAK:
- Use emojis for ratings or urgency (★★★★ or 🔴).
- Omit fluff. Use symbols like -> or > for preferences or actions.
- Only return the JSON array block.
`;

export async function processMessagesIntoMempalace(db: any, messages: ChatMessage[]): Promise<void> {
  const messagesText = messages
    .map(m => `[${m.role.toUpperCase()}]: ${m.content || (m.type === 'spec' ? `[Living Spec: ${m.specData || ''}]` : '')}`)
    .join('\n');

  if (!messagesText.trim()) return;

  const raw = await callWorkerLLM(db, AAAK_SYSTEM_PROMPT, `MESSAGES:\n${messagesText}`);

  try {
    const cleaned = raw.replace(/^\s*```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    
    if (!Array.isArray(parsed)) return;

    for (const item of parsed) {
      if (!item.wing || !item.room || !item.aaak_content) continue;

      // Ensure Wing exists
      const wingIdSafe = item.wing.toLowerCase().replace(/[^a-z0-9]/g, '_');
      db.prepare(`
        INSERT OR IGNORE INTO MP_Wings (id, name, type) 
        VALUES (?, ?, ?)
      `).run(wingIdSafe, item.wing, item.wing_type || 'topic');

      // Ensure Room exists
      const roomIdSafe = `${wingIdSafe}_${item.room.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      db.prepare(`
        INSERT OR IGNORE INTO MP_Rooms (id, wing_id, name)
        VALUES (?, ?, ?)
      `).run(roomIdSafe, wingIdSafe, item.room);

      // Create Closet
      const closetId = uuidv4();
      db.prepare(`
        INSERT INTO MP_Closets (id, room_id, hall_type, aaak_content)
        VALUES (?, ?, ?, ?)
      `).run(closetId, roomIdSafe, item.hall_type || 'hall_facts', item.aaak_content);

      // Create Drawer with raw messages snippet
      db.prepare(`
        INSERT INTO MP_Drawers (id, closet_id, raw_content, source)
        VALUES (?, ?, ?, ?)
      `).run(uuidv4(), closetId, messagesText.substring(0, 5000), 'compaction');

      // Add Triples to Knowledge Graph
      if (Array.isArray(item.triples)) {
        for (const t of item.triples) {
          if (t.subject && t.relation && t.object) {
            db.prepare(`
              INSERT INTO MP_KnowledgeGraph (id, subject, relation, object, source)
              VALUES (?, ?, ?, ?, ?)
            `).run(uuidv4(), t.subject, t.relation, t.object, 'compaction');
          }
        }
      }
    }
  } catch (e) {
    console.warn('[aaakService] Failed to parse or save AAAK json:', e);
  }
}

