import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initializeDatabase } from '../electron/database';
import { searchMeetingMemory, saveMeetingMemory } from '../electron/services/meetingService';

describe('MeetingService - Native Meeting Search', () => {
  let db: ReturnType<typeof initializeDatabase>;

  beforeEach(() => {
    // Inicializar um DB in-memory para testes
    db = initializeDatabase(':memory:');

    // Inserir algumas reuniões de teste (fazemos mock dos dados para que entrem na tabela MeetingMemory)
    saveMeetingMemory(db, {
      provider_used: 'gemini',
      raw_transcript: 'Olá a todos. Vamos falar sobre a migração de servidores de hoje.',
      summary_json: {
        title: 'Migração de Servidores',
        date: '2026-03-18T10:00:00Z',
        platform: 'zoom',
        duration: 3600,
        speakers: ['Guile', 'Alice'],
        highlights: [],
        executive_summary: 'Reunião sobre migração.',
        decisions: ['Migrar hoje'],
        action_items: []
      }
    });

    saveMeetingMemory(db, {
      provider_used: 'gemini',
      raw_transcript: 'Discutindo orçamentos do trimestre passado.',
      summary_json: {
        title: 'Reunião de Orçamento Q1',
        date: '2026-03-17T15:00:00Z',
        platform: 'teams',
        duration: 1800,
        speakers: ['Bob', 'Carol'],
        highlights: [],
        executive_summary: 'Orçamento trimestral Q1.',
        decisions: [],
        action_items: []
      }
    });
    
    saveMeetingMemory(db, {
      provider_used: 'gemini',
      raw_transcript: 'Revisão estratégica mensal.',
      summary_json: {
        title: 'Revisão Mensal - RedBus',
        date: '2026-02-15T09:00:00Z', // Mês passado
        platform: 'local',
        duration: 5400,
        speakers: ['Guile', 'David'],
        highlights: [],
        executive_summary: 'Status do projeto RedBus.',
        decisions: [],
        action_items: []
      }
    });
  });

  afterEach(() => {
    db.close();
  });

  it('1. Deve suportar busca via string legada (FTS ou LIKE genérico)', () => {
    const results = searchMeetingMemory(db, 'servidores');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Migração de Servidores');
  });

  it('2. Deve filtrar por tópico (topic)', () => {
    const results = searchMeetingMemory(db, { topic: 'Orçamento' });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Reunião de Orçamento Q1');
  });

  it('3. Deve filtrar por palestrante (speaker)', () => {
    const results = searchMeetingMemory(db, { speaker: 'Guile' });
    expect(results).toHaveLength(2); // Migração e Revisão
    expect(results.some(r => r.title === 'Migração de Servidores')).toBe(true);
    expect(results.some(r => r.title === 'Revisão Mensal - RedBus')).toBe(true);
  });

  it('4. Deve filtrar por data (today)', () => {
    // No db mock em beforeEach inserimos 'Migração de Servidores' na mesma data do teste (2026-03-18)
    // No entanto sqlite date('now') retorna a data real da execução.
    // Vamos garantir que ele procure 'today' corretamente testando via query mockada
    // Adicionamos algo forçado pro 'now' apenas para teste
    db.prepare("UPDATE MeetingMemory SET meeting_date = datetime('now', 'localtime') WHERE title = 'Migração de Servidores'").run();

    const results = searchMeetingMemory(db, { date_filter: 'today' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe('Migração de Servidores');
  });

  it('5. Deve suportar busca combinada', () => {
    const results = searchMeetingMemory(db, { speaker: 'Guile', topic: 'Revisão' });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Revisão Mensal - RedBus');
  });
});
