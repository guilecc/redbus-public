# 22. AUDIO, MEETINGS & ATA VIVA

## Arquitectura de Áudio (3 camadas)

### 1. audioRoutingService.ts — Routing macOS
Cria aggregate/multi-output audio device no macOS para capturar áudio do sistema + microfone simultaneamente.
- `createAggregateDevice(micUID, systemUID)` — cria via CoreAudio HAL
- `removeAggregateDevice()` — cleanup
- `listAudioDevices()` — lista dispositivos com UID
- Usa `coreaudio-device-list` nativo

### 2. audioAdapterService.ts — Processamento de Áudio
Focado puramente em gerir o fluxo de transcrição. Removeu-se qualquer dependência de query à base de dados de reuniões.
Dois modos de transcrição:

| Modo | STT | NLP | Áudio sai da máquina? |
|------|-----|-----|-----------------------|
| FULL_CLOUD | Gemini/Whisper API | Mesmo modelo | Sim |
| HYBRID_LOCAL | whisper-tiny local | Gemini/Worker cloud | Não (áudio fica local) |

**FULL_CLOUD** (`processAudioChunk`):
1. Recebe buffer áudio (base64 WAV)
2. Envia ao Gemini (`gemini-2.0-flash`) com prompt de transcrição
3. Analisa via LLM para gerar dados estruturados
4. Entrega ao `meetingService` para salvar na base.

**HYBRID_LOCAL** (`processHybridAudioChunk`):
1. Recebe buffer áudio
2. Transcreve localmente via `localTranscriber` (whisper-tiny)
3. Envia apenas texto ao LLM cloud para análise
4. Áudio nunca sai da máquina

### 3. localTranscriber.ts — Whisper Local
- Usa `@xenova/transformers` com modelo `Xenova/whisper-tiny`
- Roda em `worker_threads` para não bloquear main process
- Pipeline: WAV buffer → Float32Array → whisper → texto
- Converte sample rate para 16kHz via interpolação linear
- Cache de modelo em `~/.cache/redbus-models/`
- `transcribe(audioBuffer)` → `{text, segments[]}`

### 4. meetingService.ts — Gestão de Reuniões
Responsável exclusivo pelo ciclo de vida dos dados na tabela `MeetingMemory`, unificando dados originados por áudio local, extensões na nuvem (tl;dv), e **notas manuais**.
- `searchMeetingMemory(db, query)` — busca estruturada (date, topic, speaker) com fallback e split de palavras para a query de NLP
- `listMeetings(db)` — paginação cronológica
- `addManualMeeting(db, payload)` — Permite gravar atas estruturadas manualmente com suporte a conteúdo Markdown.

## MeetingMemory (Tabela — Schema Unificado)
```sql
CREATE TABLE MeetingMemory (
  id TEXT PRIMARY KEY,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  provider_used TEXT NOT NULL,       -- 'tldv', 'gemini', 'whisper', 'local'
  raw_transcript TEXT,               -- transcrição bruta
  summary_json TEXT NOT NULL,        -- JSON com executive_summary, decisions, action_items
  -- Colunas estruturadas (migração não-destrutiva)
  title TEXT,                        -- título da reunião
  meeting_date TEXT,                 -- ISO 8601 date/time
  duration_seconds INTEGER,          -- duração em segundos
  platform TEXT,                     -- 'zoom', 'teams', 'meet', 'local'
  external_id TEXT,                  -- ID externo (tl;dv id) para deduplicação
  speakers_json TEXT,                -- JSON array: [{name, id?}]
  highlights_json TEXT,              -- JSON array: [{text, speaker?, startTime?}]
  status TEXT DEFAULT 'completed',   -- 'completed', 'processing', 'reviewed'
  meeting_url TEXT                   -- link externo (tl;dv URL)
);
CREATE INDEX idx_meeting_external_id ON MeetingMemory(external_id);
```
FTS5 index em `summary_json` com triggers de sync automático.

### Fontes de dados
| Provider | Colunas preenchidas |
|----------|-------------------|
| `tldv` | Todos os campos (via tldvSensor sync) |
| `local` (gemini/whisper) | title (auto do summary), meeting_date, duration_seconds (estimado), platform='local', speakers_json (do summary) |
| `manual` | Inserção manual pelo usuário. transcript = markdownContent, summary = JSON simulado |

### IPCs de Reuniões
| IPC | Descrição |
|-----|-----------|
| `meetings:list` | Lista reuniões com paginação (limit, offset) |
| `meetings:get-details` | Detalhes completos de uma reunião (inclui transcript) |
| `meetings:get-context` | Contexto token-efficient para prompt do Maestro |
| `meetings:add-manual` | Guarda uma nota de reunião em Markdown introduzida manualmente na interface |

### getMeetingContextForPrompt
Função que formata dados da reunião para inclusão em prompts do Maestro:
- Título, data, plataforma, duração, speakers
- Highlights (até 10)
- Summary (executive_summary, decisions, action_items)
- Transcript truncado (max 2000 chars)

## MeetingsView (UI)
Componente `src/components/Meetings/MeetingsView.tsx`:
- Lista cronológica de reuniões (tl;dv + local)
- Cards com badges de origem (tl;dv roxo / Local verde) e plataforma
- Expand/collapse para ver detalhes (summary, highlights, transcript)
- Link para abrir no tl;dv (se aplicável)
- Navegação via botão 📹 no TitleBar

## MeetingReview (UI — Ata Viva)
Componente React para revisão de atas:
- Lista reuniões com busca
- Visualização de transcrição + ata lado a lado
- Edição inline da ata
- Export (futuro)

## Widget Window (WidgetOverlay.tsx)
Janela flutuante `alwaysOnTop` para controle de gravação:
- Botão gravar/parar
- Timer de duração
- Estado: idle → recording → processing → done
- Comunica com main process via IPC (`audio:*`)

## FORMAT H — Search Meeting Memory
O Maestro emite spec com `search_meeting_memory` contendo um objeto com filtros de `query`, `topic`, `speaker` e `date_filter`. O orchestrator executa `searchMeetingMemory(db, query)` usando buscas combinadas estruturadas e FTS5. Esta é a forma primária e nativa de fazer buscas complexas nas reuniões, não sendo mais necessário o uso de scripts Python (`FORMAT B`) para isso.
