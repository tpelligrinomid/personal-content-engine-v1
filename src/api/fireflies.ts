/**
 * Fireflies Integration API
 *
 * POST /api/ingest/fireflies - Ingest a Fireflies meeting transcript
 *
 * Accepts the raw Fireflies API response format and:
 * 1. Extracts metadata (title, date, participants)
 * 2. Flattens sentences into readable transcript
 * 3. Stores in source_materials
 * 4. Optionally triggers extraction
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
import { SourceMaterial, SourceMaterialInsert } from '../types';

// Fireflies API response types
interface FirefliesSentence {
  index: number;
  speaker_name: string;
  speaker_id: number;
  text: string;
  start_time: number;
  end_time: number;
}

// Downloaded JSON format (different structure)
interface FirefliesDownloadedSentence {
  sentence: string;
  startTime: string;
  endTime: string;
  speaker_name: string;
  speaker_id: number;
}

interface FirefliesSpeaker {
  id: number;
  name: string;
}

interface FirefliesSummary {
  overview?: string;
  action_items?: string;
  keywords?: string[];
  notes?: string;
}

interface FirefliesTranscript {
  id: string;
  title: string;
  dateString: string;
  duration: number;
  meeting_link?: string;
  transcript_url?: string;
  host_email?: string;
  organizer_email?: string;
  participants?: string[];
  sentences: FirefliesSentence[];
  speakers: FirefliesSpeaker[];
  summary?: FirefliesSummary;
}

interface FirefliesResponse {
  data: {
    transcript: FirefliesTranscript;
  };
}

// Wrapper for downloaded JSON format (user provides metadata)
interface FirefliesDownloadedRequest {
  title: string;
  date?: string;
  sentences: FirefliesDownloadedSentence[];
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: ApiResponse): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function isFirefliesResponse(body: unknown): body is FirefliesResponse {
  if (typeof body !== 'object' || body === null) return false;

  const obj = body as Record<string, unknown>;

  // Check for nested structure: { data: { transcript: { ... } } }
  if (!obj.data || typeof obj.data !== 'object') return false;

  const data = obj.data as Record<string, unknown>;
  if (!data.transcript || typeof data.transcript !== 'object') return false;

  const transcript = data.transcript as Record<string, unknown>;

  // Check required fields
  if (typeof transcript.title !== 'string') return false;
  if (!Array.isArray(transcript.sentences)) return false;

  return true;
}

function isFirefliesArray(body: unknown): body is FirefliesResponse[] {
  if (!Array.isArray(body)) return false;
  return body.length > 0 && isFirefliesResponse(body[0]);
}

function isDownloadedFormat(body: unknown): body is FirefliesDownloadedRequest {
  if (typeof body !== 'object' || body === null) return false;

  const obj = body as Record<string, unknown>;

  // Must have title and sentences array
  if (typeof obj.title !== 'string') return false;
  if (!Array.isArray(obj.sentences)) return false;
  if (obj.sentences.length === 0) return false;

  // Check first sentence has expected fields
  const first = obj.sentences[0] as Record<string, unknown>;
  if (typeof first.sentence !== 'string') return false;
  if (typeof first.speaker_name !== 'string') return false;

  return true;
}

function isRawSentencesArray(body: unknown): body is FirefliesDownloadedSentence[] {
  if (!Array.isArray(body)) return false;
  if (body.length === 0) return false;

  const first = body[0] as Record<string, unknown>;
  return typeof first.sentence === 'string' && typeof first.speaker_name === 'string';
}

function flattenTranscript(sentences: FirefliesSentence[]): string {
  const lines: string[] = [];
  let currentSpeaker = '';

  for (const sentence of sentences) {
    if (sentence.speaker_name !== currentSpeaker) {
      currentSpeaker = sentence.speaker_name;
      lines.push(`\n${currentSpeaker}:`);
    }
    lines.push(sentence.text);
  }

  return lines.join(' ').trim();
}

function flattenDownloadedTranscript(sentences: FirefliesDownloadedSentence[]): string {
  const lines: string[] = [];
  let currentSpeaker = '';

  for (const sentence of sentences) {
    if (sentence.speaker_name !== currentSpeaker) {
      currentSpeaker = sentence.speaker_name;
      lines.push(`\n${currentSpeaker}:`);
    }
    lines.push(sentence.sentence);
  }

  return lines.join(' ').trim();
}

function extractSpeakersFromDownloaded(sentences: FirefliesDownloadedSentence[]): string[] {
  const speakers = new Set<string>();
  for (const s of sentences) {
    speakers.add(s.speaker_name);
  }
  return [...speakers];
}

function estimateDurationFromDownloaded(sentences: FirefliesDownloadedSentence[]): string {
  if (sentences.length === 0) return 'Unknown';

  const last = sentences[sentences.length - 1];
  // endTime format is "MM:SS" or "HH:MM:SS"
  const parts = last.endTime.split(':').map(Number);
  if (parts.length === 2) {
    return `${parts[0]}m`;
  } else if (parts.length === 3) {
    return `${parts[0]}h ${parts[1]}m`;
  }
  return last.endTime;
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

async function ingestSingleTranscript(
  transcript: FirefliesTranscript,
  userId: string
): Promise<SourceMaterial> {
  const db = getDb();

  // Check if already ingested (by Fireflies ID in source_url or title match)
  const { data: existing } = await db
    .from('source_materials')
    .select('*')
    .eq('user_id', userId)
    .eq('source_url', transcript.transcript_url)
    .single();

  if (existing) {
    return existing as SourceMaterial;
  }

  // Flatten sentences into readable text
  const flattenedContent = flattenTranscript(transcript.sentences);

  // Build metadata header
  const metadata: string[] = [
    `Meeting: ${transcript.title}`,
    `Date: ${new Date(transcript.dateString).toLocaleDateString()}`,
    `Duration: ${formatDuration(transcript.duration)}`,
  ];

  if (transcript.speakers && transcript.speakers.length > 0) {
    const uniqueSpeakers = [...new Set(transcript.speakers.map((s) => s.name))];
    metadata.push(`Participants: ${uniqueSpeakers.join(', ')}`);
  }

  metadata.push('', '---', '', 'TRANSCRIPT:', '');

  const fullContent = metadata.join('\n') + flattenedContent;

  const insert: SourceMaterialInsert = {
    user_id: userId,
    type: 'meeting',
    title: transcript.title,
    content: fullContent,
    source_url: transcript.transcript_url ?? null,
    occurred_at: transcript.dateString,
  };

  const { data, error } = await db
    .from('source_materials')
    .insert(insert)
    .select()
    .single();

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data as SourceMaterial;
}

async function ingestDownloadedTranscript(
  request: FirefliesDownloadedRequest,
  userId: string
): Promise<SourceMaterial> {
  const db = getDb();

  const flattenedContent = flattenDownloadedTranscript(request.sentences);
  const speakers = extractSpeakersFromDownloaded(request.sentences);
  const duration = estimateDurationFromDownloaded(request.sentences);

  const occurredAt = request.date ? new Date(request.date).toISOString() : new Date().toISOString();

  const metadata: string[] = [
    `Meeting: ${request.title}`,
    `Date: ${new Date(occurredAt).toLocaleDateString()}`,
    `Duration: ${duration}`,
  ];

  if (speakers.length > 0) {
    metadata.push(`Participants: ${speakers.join(', ')}`);
  }

  metadata.push('', '---', '', 'TRANSCRIPT:', '');

  const fullContent = metadata.join('\n') + flattenedContent;

  const insert: SourceMaterialInsert = {
    user_id: userId,
    type: 'meeting',
    title: request.title,
    content: fullContent,
    source_url: null,
    occurred_at: occurredAt,
  };

  const { data, error } = await db
    .from('source_materials')
    .insert(insert)
    .select()
    .single();

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data as SourceMaterial;
}

async function handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = await parseBody(req);

    // Handle API response format (single or array)
    let transcripts: FirefliesTranscript[] = [];

    if (isFirefliesArray(body)) {
      transcripts = body.map((item) => item.data.transcript);
    } else if (isFirefliesResponse(body)) {
      transcripts = [body.data.transcript];
    } else if (isDownloadedFormat(body)) {
      // Handle downloaded JSON with metadata wrapper
      const result = await ingestDownloadedTranscript(body, userId);
      sendJson(res, 201, {
        success: true,
        data: {
          ingested: 1,
          source_materials: [result],
        },
      });
      return;
    } else if (isRawSentencesArray(body)) {
      // Raw sentences array - requires title in query params
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const title = url.searchParams.get('title');
      const date = url.searchParams.get('date');

      if (!title) {
        sendJson(res, 400, {
          success: false,
          error: 'Raw sentences array requires ?title= query parameter',
        });
        return;
      }

      const result = await ingestDownloadedTranscript({
        title,
        date: date ?? undefined,
        sentences: body,
      }, userId);
      sendJson(res, 201, {
        success: true,
        data: {
          ingested: 1,
          source_materials: [result],
        },
      });
      return;
    } else {
      sendJson(res, 400, {
        success: false,
        error: 'Invalid format. Expected: API response { data: { transcript } }, downloaded { title, sentences }, or raw sentences array with ?title= param',
      });
      return;
    }

    const results: SourceMaterial[] = [];
    const errors: string[] = [];

    for (const transcript of transcripts) {
      try {
        const result = await ingestSingleTranscript(transcript, userId);
        results.push(result);
      } catch (err) {
        errors.push(
          `Failed to ingest "${transcript.title}": ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }

    if (results.length === 0 && errors.length > 0) {
      sendJson(res, 500, { success: false, error: errors.join('; ') });
      return;
    }

    sendJson(res, 201, {
      success: true,
      data: {
        ingested: results.length,
        source_materials: results,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (err) {
    console.error('Error ingesting Fireflies transcript:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleFireflies(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handleIngest(req, res);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
