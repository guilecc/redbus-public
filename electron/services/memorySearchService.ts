/**
 * Memory Search Service — FTS-based retrieval of relevant context from past messages and facts.
 * Uses SQLite FTS5 when available, falls back to LIKE-based search.
 */

export interface MemorySearchResult {
  id: string;
  content: string;
  role: string;
  source: 'message' | 'fact';
  category?: string;
  createdAt: string;
  snippet: string; // highlighted/truncated excerpt
}

/**
 * Check if FTS5 table exists and is usable.
 */
function hasFts(db: any): boolean {
  try {
    db.prepare('SELECT 1 FROM ChatMessages_fts LIMIT 1').get();
    return true;
  } catch {
    return false;
  }
}

/**
 * Sync FTS index with ChatMessages table.
 * Should be called after saving new messages.
 */
export function syncFtsIndex(db: any): void {
  if (!hasFts(db)) return;
  try {
    // Rebuild FTS from ChatMessages content
    db.exec(`
      DELETE FROM ChatMessages_fts;
      INSERT INTO ChatMessages_fts(rowid, content)
        SELECT rowid, content FROM ChatMessages WHERE content IS NOT NULL AND content != '' AND (type IS NULL OR type != 'thinking');
    `);
  } catch (e) {
    console.error('[MemorySearch] FTS sync error (non-fatal):', e);
  }
}

/**
 * Search past messages and facts for content relevant to a query.
 * Returns the top N most relevant results.
 */
export function searchMemory(db: any, query: string, limit = 5): MemorySearchResult[] {
  if (!query || query.trim().length < 2) return [];

  const results: MemorySearchResult[] = [];

  // 1. Search MP_Closets (AAAK Compression Memory Palace) via FTS5
  try {
    const keywords = extractKeywords(query);
    if (keywords.length > 0) {
      const ftsQuery = keywords.join(' OR ');
      const ftsClosets = db.prepare(`
        SELECT c.id, c.aaak_content, c.hall_type, c.created_at
        FROM MP_Closets_fts f
        JOIN MP_Closets c ON c.rowid = f.rowid
        WHERE MP_Closets_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit) as any[];
      
      for (const row of ftsClosets) {
        results.push({
          id: row.id,
          content: row.aaak_content,
          role: 'system',
          source: 'fact',
          category: row.hall_type,
          createdAt: row.created_at || new Date().toISOString(),
          snippet: row.aaak_content.length > 150 ? row.aaak_content.slice(0, 150) + '…' : row.aaak_content,
        });
      }
    }
  } catch (e) {
    // Silently continue if FTS table doesn't exist yet
  }

  // 1.5 Search MemoryFacts (legacy support — always via LIKE — small table)
  try {
    const remainingFactsLimit = limit - results.length;
    if (remainingFactsLimit > 0) {
      const keywords = extractKeywords(query);
      if (keywords.length > 0) {
        const likeConditions = keywords.map(() => 'content LIKE ?').join(' OR ');
        const likeParams = keywords.map(k => `%${k}%`);
        const factRows = db.prepare(`
          SELECT id, category, content, source, createdAt
          FROM MemoryFacts
          WHERE supersededBy IS NULL AND (${likeConditions})
          ORDER BY lastReferencedAt DESC, createdAt DESC
          LIMIT ?
        `).all(...likeParams, remainingFactsLimit) as any[];

        for (const row of factRows) {
          results.push({
            id: row.id,
            content: row.content,
            role: 'system',
            source: 'fact',
            category: row.category,
            createdAt: row.createdAt,
            snippet: row.content.length > 150 ? row.content.slice(0, 150) + '…' : row.content,
          });
        }
      }
    }
  } catch (e) {
    console.error('[MemorySearch] Fact search error:', e);
  }

  // 2. Search ChatMessages via FTS5 or fallback LIKE
  try {
    const remaining = limit - results.length;
    if (remaining <= 0) return results;

    let msgRows: any[];

    if (hasFts(db)) {
      // FTS5 search
      const ftsQuery = extractKeywords(query).join(' OR ');
      if (!ftsQuery) return results;
      msgRows = db.prepare(`
        SELECT m.id, m.role, m.content, m.createdAt
        FROM ChatMessages_fts f
        JOIN ChatMessages m ON m.rowid = f.rowid
        WHERE ChatMessages_fts MATCH ?
          AND (m.type IS NULL OR m.type != 'thinking')
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, remaining) as any[];
    } else {
      // Fallback: LIKE search
      const keywords = extractKeywords(query);
      if (keywords.length === 0) return results;
      const likeConditions = keywords.map(() => 'content LIKE ?').join(' OR ');
      const likeParams = keywords.map(k => `%${k}%`);
      msgRows = db.prepare(`
        SELECT id, role, content, createdAt
        FROM ChatMessages
        WHERE content IS NOT NULL AND (type IS NULL OR type != 'thinking') AND (${likeConditions})
        ORDER BY createdAt DESC
        LIMIT ?
      `).all(...likeParams, remaining) as any[];
    }

    for (const row of msgRows) {
      const text = row.content || '';
      results.push({
        id: row.id,
        content: text,
        role: row.role,
        source: 'message',
        createdAt: row.createdAt,
        snippet: text.length > 200 ? text.slice(0, 200) + '…' : text,
      });
    }
  } catch (e) {
    console.error('[MemorySearch] Message search error:', e);
  }

  return results;
}

/**
 * Simple keyword extractor: splits query, removes short/stop words.
 */
function extractKeywords(query: string): string[] {
  const stops = new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'em', 'no', 'na', 'com', 'por', 'para',
    'que', 'se', 'e', 'ou', 'mas', 'the', 'is', 'are', 'was', 'of', 'in', 'to', 'and', 'or',
    'me', 'meu', 'minha', 'eu', 'você', 'esse', 'essa', 'este', 'esta', 'isso', 'aquele',
    'lembra', 'lembrar', 'remember', 'what', 'how', 'when', 'where', 'como', 'quando', 'onde',
  ]);
  return query
    .toLowerCase()
    .replace(/[^\w\sÀ-ÿ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stops.has(w));
}

