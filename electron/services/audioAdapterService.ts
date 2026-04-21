/**
 * AudioAdapterService — Adapter pattern for audio transcription + meeting analysis.
 *
 * Strategies:
 *   A) Google Gemini — Multimodal native audio (transcription + NLP in one call)
 *   B) OpenAI Whisper — Transcription only, then LLM for NLP
 *   C) Local (Transformers.js) — Offline transcription, then LLM for NLP (stub)
 */

import { fetchWithTimeout } from '../plugins';
import crypto from 'crypto';
import { logActivity } from './activityLogger';
import { chatWithRole, resolveRole } from './roles';

export type TranscriptionEngine = 'gemini' | 'whisper' | 'local';
export type TranscriptionMode = 'FULL_CLOUD' | 'HYBRID_LOCAL';

export interface MeetingAnalysis {
  provider_used: TranscriptionEngine;
  raw_transcript: string | null;
  summary_json: {
    title: string;
    date?: string;
    platform?: string;
    duration?: number;
    speakers: string[];
    highlights: { text: string; speaker?: string; type?: string }[];
    meeting_url?: string | null;
    executive_summary: string;
    decisions: string[];
    action_items: { owner: string; task: string; deadline?: string }[];
  };
}

/* ── Gemini Strategy (A) — Single multimodal call ── */

async function processWithGemini(audioBuffer: Buffer, mimeType: string, googleKey: string, model: string): Promise<MeetingAnalysis> {
  const base64Audio = audioBuffer.toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleKey}`;

  const systemPrompt = `You are a meeting analyst. Listen to this audio recording carefully.
First, produce a FULL VERBATIM transcription of everything said (in the original language).
Then, extract a structured analysis from that transcription.
Return ONLY valid JSON with this exact schema:
{
  "raw_transcript": "string (full verbatim transcription of the audio, preserving the original language)",
  "title": "string (A short, descriptive title for the meeting)",
  "date": "string (ISO 8601 date, if mentioned, otherwise leave empty)",
  "platform": "string (e.g., 'local', 'zoom', etc., default to 'local')",
  "duration": 0,
  "speakers": ["string (names mentioned or distinct speakers)"],
  "highlights": [{"text": "string (a key point or quote)", "speaker": "string", "type": "string (e.g., 'note', 'decision', 'action')"}],
  "meeting_url": null,
  "executive_summary": "string (2-3 paragraph summary of the meeting)",
  "decisions": ["string (each decision made)"],
  "action_items": [{"owner": "string", "task": "string", "deadline": "string or null"}]
}`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{
        parts: [
          { inlineData: { mimeType, data: base64Audio } },
          { text: 'Analyze this meeting recording. Return structured JSON only.' }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  }, 300_000); // 5 min timeout for long audio

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Audio API error: ${errText}`);
  }

  const data = await response.json();
  const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) throw new Error('Gemini returned empty response for audio');

  const parsed = JSON.parse(rawJson);
  // Extract raw_transcript from the combined Gemini response
  const transcript = parsed.raw_transcript || null;
  // Remove raw_transcript from summary_json to keep it separate
  const { raw_transcript: _discard, ...summaryOnly } = parsed;
  return {
    provider_used: 'gemini',
    raw_transcript: transcript,
    summary_json: summaryOnly,
  };
}

/* ── Whisper Strategy (B) — Transcribe then analyze ── */

async function processWithWhisper(db: any, audioBuffer: Buffer, mimeType: string, openAiKey: string): Promise<MeetingAnalysis> {
  // Step 1: Transcribe with Whisper
  const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : 'wav';
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, `meeting.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'text');
  formData.append('language', 'pt'); // Default to Portuguese, could be configurable

  const transcriptRes = await fetchWithTimeout('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openAiKey}` },
    body: formData as any,
  }, 300_000);

  if (!transcriptRes.ok) {
    const errText = await transcriptRes.text();
    throw new Error(`Whisper API error: ${errText}`);
  }

  const transcript = await transcriptRes.text();

  // Step 2: Analyze transcript with the utility role LLM
  const summary_json = await analyzeTranscript(db, transcript);

  return {
    provider_used: 'whisper',
    raw_transcript: transcript,
    summary_json,
  };
}

/* ── Local Strategy (C) — DEPRECATED: now handled via IPC 'audio:process-hybrid' ── */
/* The HYBRID_LOCAL flow is handled directly in ipcHandlers.ts:
 *   1. Renderer decodes webm → Float32 PCM via OfflineAudioContext
 *   2. IPC sends PCM to main process
 *   3. localTranscriber.ts runs whisper-tiny in worker_threads
 *   4. analyzeTranscriptFromText sends text to cloud NLP
 */

/* ── Shared: Analyze transcript text with configured LLM ── */

async function analyzeTranscript(db: any, transcript: string, isLocalTranscript = false): Promise<MeetingAnalysis['summary_json']> {
  const localDisclaimer = isLocalTranscript
    ? `\nIMPORTANT: This transcript was generated by a small local speech model (whisper-tiny) and MAY contain phonetic errors, misspellings, or wrong word boundaries. Use contextual inference to correct names, technical terms, and unclear passages before extracting the analysis.`
    : '';

  const systemPrompt = `You are a meeting analyst. Given a meeting transcript, extract a structured analysis.${localDisclaimer}
Return ONLY valid JSON with this exact schema:
{
  "title": "string (A short, descriptive title for the meeting)",
  "date": "string (ISO 8601 date, if mentioned, otherwise leave empty)",
  "platform": "string (e.g., 'local', 'zoom', etc., default to 'local')",
  "duration": 0,
  "speakers": ["string (names mentioned or distinct speakers)"],
  "highlights": [{"text": "string (a key point or quote)", "speaker": "string", "type": "string (e.g., 'note', 'decision', 'action')"}],
  "meeting_url": null,
  "executive_summary": "string",
  "decisions": ["string"],
  "action_items": [{"owner": "string", "task": "string", "deadline": "string or null"}]
}`;

  const userPrompt = `Meeting transcript:\n${transcript.slice(0, 30000)}`;

  const result = await chatWithRole(db, 'utility', {
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    responseFormat: 'json_object',
    maxTokens: 4096,
  });
  const raw = result.content || '';
  return JSON.parse(raw);
}

/**
 * Public API: Analyze pre-transcribed text via cloud LLM.
 * Used by the HYBRID_LOCAL path when the renderer Web Worker has already done STT.
 */
export async function analyzeTranscriptFromText(db: any, transcript: string): Promise<MeetingAnalysis['summary_json']> {
  return analyzeTranscript(db, transcript, true);
}

/* ── Public API ── */

export async function processAudio(
  db: any,
  audioBuffer: Buffer,
  mimeType: string,
  engine: TranscriptionEngine,
  configs: { googleKey?: string; openAiKey?: string;[k: string]: any }
): Promise<MeetingAnalysis> {
  console.log(`[AudioAdapter] Processing audio (${(audioBuffer.length / 1024).toFixed(0)} KB) with engine: ${engine}`);
  logActivity('meetings', `Processando áudio (${(audioBuffer.length / 1024).toFixed(0)} KB) com engine: ${engine}`);

  switch (engine) {
    case 'gemini': {
      if (!configs.googleKey) throw new Error('Google API key required for Gemini audio processing');
      // For Gemini's multimodal audio endpoint, we need a Gemini model. Prefer
      // the utility role when it's already a Gemini model, otherwise fall back.
      const utilityModel = resolveRole(db, 'utility').model;
      const model = utilityModel.includes('gemini') ? utilityModel : 'gemini-2.0-flash';
      return processWithGemini(audioBuffer, mimeType, configs.googleKey, model);
    }
    case 'whisper': {
      if (!configs.openAiKey) throw new Error('OpenAI API key required for Whisper transcription');
      return processWithWhisper(db, audioBuffer, mimeType, configs.openAiKey);
    }
    case 'local': {
      throw new Error('Local engine is now handled via IPC audio:process-hybrid. Use HYBRID_LOCAL mode in settings.');
    }
    default:
      throw new Error(`Unknown transcription engine: ${engine}`);
  }
}



