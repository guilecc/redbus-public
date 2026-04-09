import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  ensureMessagesTable,
  saveMessage,
  getMessages,
  countMessages,
  archiveOldMessages,
  listArchiveFiles,
  deleteArchiveFile
} from '../electron/services/archiveService';

describe('ArchiveService - Histórico e Particionamento', () => {
  let db: any;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redbus-archive-test-'));
    db = new Database(':memory:');
    ensureMessagesTable(db);
  });

  afterEach(() => {
    db.close();
    // Clean up temp archives dir
    if (fs.existsSync(path.join(tmpDir, 'archives'))) {
      fs.rmSync(path.join(tmpDir, 'archives'), { recursive: true });
    }
    fs.rmdirSync(tmpDir);
  });

  it('1. Deve criar a tabela ChatMessages e inserir/ler mensagens', () => {
    saveMessage(db, { id: 'msg-1', role: 'user', content: 'Olá!' });
    saveMessage(db, { id: 'msg-2', role: 'assistant', content: 'Oi!' });

    const msgs = getMessages(db, 10, 0);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe('msg-1');
    expect(msgs[1].role).toBe('assistant');
  });

  it('2. Deve arquivar mensagens antigas quando o limite de registros é excedido', () => {
    // Insert 100 messages with old dates
    const insertMsg = db.prepare(`
      INSERT INTO ChatMessages (id, role, content, createdAt)
      VALUES (?, ?, ?, ?)
    `);
    for (let i = 0; i < 100; i++) {
      const oldDate = new Date('2020-01-01');
      oldDate.setDate(oldDate.getDate() + i);
      insertMsg.run(`id-${i}`, 'user', `Mensagem ${i}`, oldDate.toISOString());
    }

    const countBefore = countMessages(db);
    expect(countBefore).toBe(100);

    // Archive with maxRows = 50 (should archive ~30 oldest)
    const archivePath = archiveOldMessages(db, tmpDir, 7, 50);

    expect(archivePath).not.toBeNull();
    expect(archivePath!).toContain('.redbus_archive_');
    expect(fs.existsSync(archivePath!)).toBe(true);

    const countAfter = countMessages(db);
    expect(countAfter).toBeLessThan(countBefore);
    expect(countAfter).toBeLessThanOrEqual(50); // at most maxRows * 0.7 + remaining
  });

  it('3. Deve arquivar mensagens com mais de N dias por data', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10); // 10 days ago

    db.prepare(`INSERT INTO ChatMessages (id, role, content, createdAt) VALUES (?, ?, ?, ?)`)
      .run('old-1', 'user', 'Mensagem velha', oldDate.toISOString());
    
    db.prepare(`INSERT INTO ChatMessages (id, role, content, createdAt) VALUES (?, ?, ?, ?)`)
      .run('new-1', 'user', 'Mensagem nova', new Date().toISOString());

    const archivePath = archiveOldMessages(db, tmpDir, 7, 10000);
    expect(archivePath).not.toBeNull();

    const remaining = getMessages(db, 100, 0);
    const remainingIds = remaining.map(m => m.id);
    expect(remainingIds).toContain('new-1');
    expect(remainingIds).not.toContain('old-1');
  });

  it('4. Deve listar e deletar arquivos de histórico', () => {
    // Create a fake archive file
    const archivesDir = path.join(tmpDir, 'archives');
    fs.mkdirSync(archivesDir);
    const fakeFilePath = path.join(archivesDir, '.redbus_archive_20260101.sqlite');
    fs.writeFileSync(fakeFilePath, 'fake');

    const archives = listArchiveFiles(tmpDir);
    expect(archives).toHaveLength(1);
    expect(archives[0].filename).toBe('.redbus_archive_20260101.sqlite');

    const deleted = deleteArchiveFile(tmpDir, '.redbus_archive_20260101.sqlite');
    expect(deleted).toBe(true);
    expect(fs.existsSync(fakeFilePath)).toBe(false);

    const archivesAfter = listArchiveFiles(tmpDir);
    expect(archivesAfter).toHaveLength(0);
  });

  it('5. Retorna null se não há mensagens para arquivar', () => {
    saveMessage(db, { id: 'fresh', role: 'user', content: 'nova mensagem' });
    const result = archiveOldMessages(db, tmpDir, 7, 10000);
    expect(result).toBeNull();
  });
});
