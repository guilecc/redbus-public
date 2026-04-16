import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { ensureMessagesTable } from './services/archiveService';

export function initializeDatabase(customPath?: string) {
  // Redbus strategy: everything lives in a single local sqlite file for easy backup and full privacy.
  const dbPath = customPath || path.join(app.getPath('userData'), '.redbus');

  // Safety: if database file exists, verify integrity before opening.
  // Corrupted WAL/SHM files cause SIGSEGV in better-sqlite3 native code.
  if (dbPath !== ':memory:' && fs.existsSync(dbPath)) {
    try {
      const testDb = new Database(dbPath);
      const integrity = testDb.pragma('integrity_check', { simple: true });
      testDb.close();
      if (integrity !== 'ok') {
        console.error(`[Database] Integrity check failed: ${integrity}. Backing up and recreating.`);
        const backupPath = `${dbPath}.corrupt.${Date.now()}`;
        fs.renameSync(dbPath, backupPath);
        // Also remove WAL and SHM files
        if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
        if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      }
    } catch (e) {
      console.error(`[Database] Cannot open existing database: ${e}. Backing up and recreating.`);
      const backupPath = `${dbPath}.corrupt.${Date.now()}`;
      try { fs.renameSync(dbPath, backupPath); } catch { }
      try { if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`); } catch { }
      try { if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`); } catch { }
    }
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency and performance
  db.pragma('journal_mode = WAL');

  // Schema 1: UserConfig
  db.exec(`
    CREATE TABLE IF NOT EXISTS UserConfig (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Schema 2: Conversations
  db.exec(`
    CREATE TABLE IF NOT EXISTS Conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Schema 3: LivingSpecs
  // Padrão 'Living Spec': O Maestro cria um Spec das tarefas, os Workers executam e atualizam.
  db.exec(`
    CREATE TABLE IF NOT EXISTS LivingSpecs (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      status TEXT CHECK( status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'FAILED') ) DEFAULT 'DRAFT',
      specJson TEXT NOT NULL,
      cron_expression TEXT,
      last_run DATETIME,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversationId) REFERENCES Conversations(id)
    );
  `);

  // Safe schema migrations for existing databases
  try {
    db.exec(`ALTER TABLE LivingSpecs ADD COLUMN cron_expression TEXT;`);
  } catch (e) {
    // Ignore error if column already exists
  }
  try {
    db.exec(`ALTER TABLE LivingSpecs ADD COLUMN last_run DATETIME;`);
  } catch (e) {
    // Ignore error if column already exists
  }
  // Routine-related columns
  try { db.exec(`ALTER TABLE LivingSpecs ADD COLUMN enabled INTEGER DEFAULT 1;`); } catch (_) { }
  try { db.exec(`ALTER TABLE LivingSpecs ADD COLUMN next_run_at TEXT;`); } catch (_) { }
  try { db.exec(`ALTER TABLE LivingSpecs ADD COLUMN consecutive_errors INTEGER DEFAULT 0;`); } catch (_) { }
  try { db.exec(`ALTER TABLE LivingSpecs ADD COLUMN last_error TEXT;`); } catch (_) { }
  try { db.exec(`ALTER TABLE LivingSpecs ADD COLUMN last_duration_ms INTEGER;`); } catch (_) { }
  try { db.exec(`ALTER TABLE LivingSpecs ADD COLUMN timezone TEXT DEFAULT 'America/Sao_Paulo';`); } catch (_) { }

  // Schema: RoutineExecutions — log of each cron execution
  db.exec(`
    CREATE TABLE IF NOT EXISTS RoutineExecutions (
      id TEXT PRIMARY KEY,
      specId TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      endedAt TEXT,
      status TEXT CHECK(status IN ('running','ok','error','skipped')) DEFAULT 'running',
      error TEXT,
      summary TEXT,
      durationMs INTEGER,
      FOREIGN KEY (specId) REFERENCES LivingSpecs(id)
    );
  `);

  // Schema 4: EmbeddingsMemory (Preparado para busca vetorial)
  db.exec(`
    CREATE TABLE IF NOT EXISTS EmbeddingsMemory (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata TEXT,
      embedding BLOB,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Schema 4.1: VectorMemory (Preparado para armazenar embeddings no futuro)
  db.exec(`
    CREATE TABLE IF NOT EXISTS VectorMemory (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Schema 4.2: UserProfile (A Alma do RedBus)
  db.exec(`
    CREATE TABLE IF NOT EXISTS UserProfile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      preferences TEXT,
      system_prompt_compiled TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: add system_prompt_compiled to existing UserProfile tables that pre-date this column
  try {
    db.exec(`ALTER TABLE UserProfile ADD COLUMN system_prompt_compiled TEXT NOT NULL DEFAULT '';`);
  } catch (_) { /* column already exists — ignore */ }
  // Backfill any NULL values left by old rows
  try {
    db.exec(`UPDATE UserProfile SET system_prompt_compiled = '' WHERE system_prompt_compiled IS NULL;`);
  } catch (_) { }

  // Schema 5: ProviderConfigs
  db.exec(`
    CREATE TABLE IF NOT EXISTS ProviderConfigs (
      id INTEGER PRIMARY KEY CHECK (id = 1), -- Ensure single row
      openAiKey TEXT,
      anthropicKey TEXT,
      googleKey TEXT,
      ollamaUrl TEXT DEFAULT 'http://localhost:11434',
      ollamaCloudKey TEXT,
      ollamaCloudUrl TEXT DEFAULT 'https://api.ollama.com',
      maestroModel TEXT DEFAULT 'claude-3-7-sonnet-20250219',
      workerModel TEXT DEFAULT 'gemini-2.5-flash',
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Insert default row if not exists
    INSERT OR IGNORE INTO ProviderConfigs (id) VALUES (1);
  `);

  try {
    db.exec('ALTER TABLE ProviderConfigs ADD COLUMN ollamaUrl TEXT DEFAULT "http://localhost:11434";');
  } catch (e) { }

  try {
    db.exec('ALTER TABLE ProviderConfigs ADD COLUMN ollamaCloudKey TEXT;');
  } catch (e) { }

  try {
    db.exec('ALTER TABLE ProviderConfigs ADD COLUMN ollamaCloudUrl TEXT DEFAULT "https://ollama.com";');
  } catch (e) { }

  // Migrate invalid model name to correct one if user has saved it previously
  try {
    db.exec(`
       UPDATE ProviderConfigs 
       SET maestroModel = 'claude-3-7-sonnet-20250219' 
       WHERE maestroModel = 'claude-3-5-sonnet-20241022'
     `);
  } catch (e) {
    // Ignore in memory/mock db tests
  }

  // Schema 6: ChatMessages — single persistent session history
  ensureMessagesTable(db);

  // Schema 7: ConversationSummary — rolling compacted summary for context window management
  db.exec(`
    CREATE TABLE IF NOT EXISTS ConversationSummary (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      summary TEXT NOT NULL DEFAULT '',
      lastCompactedAt DATETIME,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO ConversationSummary (id, summary) VALUES (1, '');
  `);

  // Migration: Add compacted flag to ChatMessages for existing databases
  try {
    db.exec(`ALTER TABLE ChatMessages ADD COLUMN compacted INTEGER NOT NULL DEFAULT 0;`);
  } catch (e) {
    // Column already exists — ignore
  }

  // ConversationSummary migrations: token tracking
  try { db.exec(`ALTER TABLE ConversationSummary ADD COLUMN token_estimate INTEGER DEFAULT 0;`); } catch (_) { }
  try { db.exec(`ALTER TABLE ConversationSummary ADD COLUMN generation_count INTEGER DEFAULT 0;`); } catch (_) { }

  // Schema: MemoryFacts — extracted key facts for long-term memory
  db.exec(`
    CREATE TABLE IF NOT EXISTS MemoryFacts (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      confidence REAL DEFAULT 1.0,
      lastReferencedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      supersededBy TEXT
    );
  `);

  // --- MEMPALACE ARCHITECTURE ---

  // Schema: MP_Wings (Projects and People)
  db.exec(`
    CREATE TABLE IF NOT EXISTS MP_Wings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT CHECK(type IN ('person', 'project', 'topic')) DEFAULT 'topic',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Schema: MP_Rooms (Topics within a Wing)
  db.exec(`
    CREATE TABLE IF NOT EXISTS MP_Rooms (
      id TEXT PRIMARY KEY,
      wing_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (wing_id) REFERENCES MP_Wings(id),
      UNIQUE(wing_id, name)
    );
  `);

  // Schema: MP_Closets (Lossless AAAK compressed memory facts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS MP_Closets (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      hall_type TEXT DEFAULT 'hall_facts',
      aaak_content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES MP_Rooms(id)
    );
  `);

  // Schema: MP_Drawers (Original verbatim messages and facts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS MP_Drawers (
      id TEXT PRIMARY KEY,
      closet_id TEXT,
      raw_content TEXT NOT NULL,
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (closet_id) REFERENCES MP_Closets(id)
    );
  `);

  // Schema: MP_KnowledgeGraph (Temporal Entity Graph)
  db.exec(`
    CREATE TABLE IF NOT EXISTS MP_KnowledgeGraph (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      relation TEXT NOT NULL,
      object TEXT NOT NULL,
      valid_from DATETIME DEFAULT CURRENT_TIMESTAMP,
      valid_to DATETIME,
      source TEXT
    );
  `);

  // FTS5 index on MP_Closets for full-text retrieval of wings/rooms/facts
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS MP_Closets_fts USING fts5(aaak_content, hall_type, content='MP_Closets', content_rowid='rowid');`);
  } catch (_) { }

  // Triggers to keep FTS5 in sync with MP_Closets
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS MP_Closets_ai AFTER INSERT ON MP_Closets BEGIN
        INSERT INTO MP_Closets_fts(rowid, aaak_content, hall_type) VALUES (new.rowid, new.aaak_content, new.hall_type);
      END;
      CREATE TRIGGER IF NOT EXISTS MP_Closets_au AFTER UPDATE ON MP_Closets BEGIN
        INSERT INTO MP_Closets_fts(MP_Closets_fts, rowid, aaak_content, hall_type) VALUES ('delete', old.rowid, old.aaak_content, old.hall_type);
        INSERT INTO MP_Closets_fts(rowid, aaak_content, hall_type) VALUES (new.rowid, new.aaak_content, new.hall_type);
      END;
      CREATE TRIGGER IF NOT EXISTS MP_Closets_ad AFTER DELETE ON MP_Closets BEGIN
        INSERT INTO MP_Closets_fts(MP_Closets_fts, rowid, aaak_content, hall_type) VALUES ('delete', old.rowid, old.aaak_content, old.hall_type);
      END;
    `);
  } catch (_) { }


  // FTS5 index on ChatMessages for full-text search retrieval
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ChatMessages_fts USING fts5(content, content_rowid='rowid');`);
  } catch (_) {
    // FTS5 may already exist or not be available
  }

  // Schema 10: ScreenMemory — OCR text extracted from screen captures (Photographic Eye)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ScreenMemory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      active_app TEXT,
      active_title TEXT,
      extracted_text TEXT NOT NULL,
      text_hash TEXT NOT NULL
    );
  `);

  // FTS5 index on ScreenMemory for full-text search
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ScreenMemory_fts USING fts5(extracted_text, content='ScreenMemory', content_rowid='id');`);
  } catch (_) {
    // FTS5 may already exist
  }

  // Triggers to keep FTS5 in sync with ScreenMemory
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ScreenMemory_ai AFTER INSERT ON ScreenMemory BEGIN
        INSERT INTO ScreenMemory_fts(rowid, extracted_text) VALUES (new.id, new.extracted_text);
      END;
      CREATE TRIGGER IF NOT EXISTS ScreenMemory_ad AFTER DELETE ON ScreenMemory BEGIN
        INSERT INTO ScreenMemory_fts(ScreenMemory_fts, rowid, extracted_text) VALUES ('delete', old.id, old.extracted_text);
      END;
    `);
  } catch (_) {
    // Triggers may already exist
  }

  // Schema 8: SecureVault — encrypted tokens for external services (Jira, GitHub, AWS, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS SecureVault (
      id TEXT PRIMARY KEY,
      service_name TEXT NOT NULL,
      encrypted_token TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Schema 9: SkillLibrary — Self-extending AI tool library (forged by Maestro)
  // Forge: unified code snippets (absorbs old SkillLibrary)
  // Stores reusable code in any language, created by Maestro or Workers.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ForgeSnippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      language TEXT NOT NULL DEFAULT 'python',
      code TEXT NOT NULL,
      description TEXT,
      tags TEXT DEFAULT '[]',
      parameters_schema TEXT DEFAULT '{}',
      required_vault_keys TEXT DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME
    );
  `);

  // Forge: execution history log
  db.exec(`
    CREATE TABLE IF NOT EXISTS ForgeExecutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snippet_id INTEGER REFERENCES ForgeSnippets(id),
      spec_id TEXT,
      command TEXT NOT NULL,
      stdout TEXT,
      stderr TEXT,
      exit_code INTEGER,
      duration_ms INTEGER,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: Add Forge columns to existing ForgeSnippets tables (pre-consolidation DBs)
  const forgeColumns = [
    { col: 'parameters_schema', def: "TEXT DEFAULT '{}'" },
    { col: 'required_vault_keys', def: "TEXT DEFAULT '[]'" },
    { col: 'version', def: 'INTEGER NOT NULL DEFAULT 1' },
  ];
  for (const { col, def } of forgeColumns) {
    try {
      db.exec(`ALTER TABLE ForgeSnippets ADD COLUMN ${col} ${def};`);
    } catch (e) {
      // Column already exists — ignore
    }
  }

  // --- NATIVE SYSTEM SKILLS ---
  // Note: search_meetings_advanced was removed as native search is handled by dedicated FORMAT H.


  // Schema 11: MeetingMemory — Audio sensor meeting transcripts and analyses
  db.exec(`
    CREATE TABLE IF NOT EXISTS MeetingMemory (
      id TEXT PRIMARY KEY,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      provider_used TEXT NOT NULL,
      raw_transcript TEXT,
      summary_json TEXT NOT NULL
    );
  `);

  // Migration: Add structured columns to MeetingMemory (non-destructive)
  const meetingColumns = [
    { col: 'title', def: 'TEXT' },
    { col: 'meeting_date', def: 'TEXT' },
    { col: 'duration_seconds', def: 'INTEGER' },
    { col: 'platform', def: 'TEXT' },
    { col: 'external_id', def: 'TEXT' },
    { col: 'speakers_json', def: 'TEXT' },
    { col: 'highlights_json', def: 'TEXT' },
    { col: 'transcript_json', def: 'TEXT' },
    { col: 'status', def: "TEXT DEFAULT 'completed'" },
    { col: 'meeting_url', def: 'TEXT' },
  ];
  for (const { col, def } of meetingColumns) {
    try { db.exec(`ALTER TABLE MeetingMemory ADD COLUMN ${col} ${def};`); } catch (_) { /* already exists */ }
  }

  // Index for deduplication by external_id
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_meeting_external_id ON MeetingMemory(external_id);`); } catch (_) { }

  // FTS5 index on MeetingMemory for full-text search
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS MeetingMemory_fts USING fts5(summary_json, content='MeetingMemory', content_rowid='rowid');`);
  } catch (_) {
    // FTS5 may already exist
  }

  // Triggers to keep FTS5 in sync with MeetingMemory
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS MeetingMemory_ai AFTER INSERT ON MeetingMemory BEGIN
        INSERT INTO MeetingMemory_fts(rowid, summary_json) VALUES (new.rowid, new.summary_json);
      END;
      CREATE TRIGGER IF NOT EXISTS MeetingMemory_ad AFTER DELETE ON MeetingMemory BEGIN
        INSERT INTO MeetingMemory_fts(MeetingMemory_fts, rowid, summary_json) VALUES('delete', old.rowid, old.summary_json);
      END;
    `);
  } catch (_) { /* triggers may already exist */ }

  // Schema 13: ActivityLog — persistent activity log entries (critical events only)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ActivityLog (
      id TEXT PRIMARY KEY,
      timestamp DATETIME NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT
    );
  `);

  // Schema 12: CommunicationDigest — daily email/message digests
  db.exec(`
    CREATE TABLE IF NOT EXISTS CommunicationDigest (
      id TEXT PRIMARY KEY,
      digest_date TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'all',
      total_messages INTEGER DEFAULT 0,
      summary_json TEXT NOT NULL,
      raw_messages_json TEXT,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_digest_date ON CommunicationDigest(digest_date);`); } catch { }

  // Schema 13: AppSettings — key/value store for application settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS AppSettings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Default: data_retention_days = 7
  // Data retention settings are now hardcoded and perpetual (MemPalace)
  // AppSettings for other flags keep existing logic

  // Schema 14: Todos — Task management system
  db.exec(`
    CREATE TABLE IF NOT EXISTS Todos (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      target_date DATETIME,
      status TEXT CHECK(status IN ('pending', 'completed')) DEFAULT 'pending',
      archived INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

/* ═══════════════════════════════════════════════
   App Settings helpers
   ═══════════════════════════════════════════════ */

export function getAppSetting(db: ReturnType<typeof Database>, key: string): string | null {
  const row = db.prepare('SELECT value FROM AppSettings WHERE key = ?').get(key) as any;
  return row?.value ?? null;
}

export function setAppSetting(db: ReturnType<typeof Database>, key: string, value: string): void {
  db.prepare(`
    INSERT INTO AppSettings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP
  `).run(key, value);
}

export function getLanguagePromptDirective(db: ReturnType<typeof Database>): string {
  const lang = getAppSetting(db, 'language');
  if (lang === 'en') {
    return '\n[CRITICAL: RESPOND EXCLUSIVELY IN ENGLISH]\n';
  } else if (lang === 'pt-BR') {
    return '\n[CRITICAL: RESPOND EXCLUSIVELY IN BRAZILIAN PORTUGUESE (PT-BR)]\n';
  }
  return ''; // default if not set
}

/* ═══════════════════════════════════════════════
   Data Retention — Cleanup + VACUUM
   ═══════════════════════════════════════════════ */

/**
 * Delete old records from temporal tables and VACUUM the database.
 * Reads `data_retention_days` from AppSettings (default: 7).
 * Returns the total number of deleted rows.
 */
export function cleanupOldMemories(db: ReturnType<typeof Database>): number {
  // Perpetual storage (MemPalace): We no longer delete ChatMessages or MemoryFacts.
  // We keep a 90-day safety cleanup for heavy data (ScreenMemory and Logs) only.
  const days = 90;

  let totalDeleted = 0;

  // 1. ScreenMemory — OCR screen captures (Heavy data)
  try {
    const r1 = db.prepare(`DELETE FROM ScreenMemory WHERE timestamp < datetime('now', '-${days} days')`).run();
    totalDeleted += r1.changes;
  } catch (_) { }

  // 2. ChatMessages — we keep them forever (MemPalace)
  // 3. RoutineExecutions — old routine execution logs (Technical logs)
  try {
    const r3 = db.prepare(`DELETE FROM RoutineExecutions WHERE startedAt < datetime('now', '-${days} days')`).run();
    totalDeleted += r3.changes;
  } catch (_) { }

  // 4. ForgeExecutions — old forge execution logs (Technical logs)
  try {
    const r4 = db.prepare(`DELETE FROM ForgeExecutions WHERE executed_at < datetime('now', '-${days} days')`).run();
    totalDeleted += r4.changes;
  } catch (_) { }

  // 5. MeetingMemory — meeting transcripts are kept (MemPalace)

  // VACUUM — reclaim disk space
  if (totalDeleted > 0) {
    try {
      db.exec('VACUUM;');
      console.log(`[Cleanup] Eliminados ${totalDeleted} registos técnicos antigos (>${days} dias). VACUUM executado.`);
    } catch (e) {
      console.warn('[Cleanup] VACUUM falhou:', e);
    }
  }

  return totalDeleted;
}

/**
 * Factory Reset: Wipe all user data (Alma, messages, specs, memory) but PRESERVE API keys.
 * Also deletes archive .sqlite files from disk.
 */
export function factoryReset(db: ReturnType<typeof Database>, userDataPath: string): void {
  // Disable FK constraints during reset to avoid ordering issues
  db.pragma('foreign_keys = OFF');

  // Wipe tables that hold user identity, conversation, and memory data
  db.exec(`
    DELETE FROM RoutineExecutions;
    DELETE FROM ForgeExecutions;
    DELETE FROM ForgeSnippets;
    DELETE FROM ChatMessages;
    DELETE FROM LivingSpecs;
    DELETE FROM Conversations;
    DELETE FROM UserProfile;
    DELETE FROM EmbeddingsMemory;
    DELETE FROM VectorMemory;
    DELETE FROM MemoryFacts;
    DELETE FROM MP_Drawers;
    DELETE FROM MP_Closets;
    DELETE FROM MP_Rooms;
    DELETE FROM MP_Wings;
    DELETE FROM MP_KnowledgeGraph;
    DELETE FROM ScreenMemory;
    DELETE FROM MeetingMemory;
    DELETE FROM CommunicationDigest;
    DELETE FROM SecureVault;
    DELETE FROM ActivityLog;
    DELETE FROM AppSettings;
    UPDATE ConversationSummary SET summary = '', lastCompactedAt = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = 1;
  `);

  // Re-enable FK constraints
  db.pragma('foreign_keys = ON');

  // Delete archive files from disk
  const archivesDir = path.join(userDataPath, 'archives');
  if (fs.existsSync(archivesDir)) {
    const files = fs.readdirSync(archivesDir).filter(f => f.endsWith('.sqlite'));
    for (const file of files) {
      fs.unlinkSync(path.join(archivesDir, file));
    }
  }
}
