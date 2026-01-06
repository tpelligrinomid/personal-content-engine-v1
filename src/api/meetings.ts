/**
 * Simple Meeting Transcript Ingest API
 *
 * POST /api/ingest/meeting - Ingest a meeting transcript (plain text or JSON sentences)
 *
 * Simpler alternative to /api/ingest/fireflies for manual entry.
 * Accepts either plain text transcript or Fireflies-style JSON sentences.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
import { SourceMaterial, SourceMaterialInsert } from '../types';

interface FirefliesSentence {
  sentence: string;
  startTime?: string;
  endTime?: string;
  speaker_name: string;
  speaker_id?: number;
}

interface MeetingRequest {
  title: string;
  content?: string; // Plain text transcript
  sentences?: FirefliesSentence[]; // Or Fireflies-style sentences
  occurred_at?: string;
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

function isValidRequest(body: unknown): body is MeetingRequest {
  if (typeof body !== 'object' || body === null) return false;

  const obj = body as Record<string, unknown>;

  if (typeof obj.title !== 'string' || obj.title.trim() === '') return false;

  // Must have either content (string) or sentences (array)
  const hasContent = typeof obj.content === 'string' && obj.content.trim() !== '';
  const hasSentences = Array.isArray(obj.sentences) && obj.sentences.length > 0;

  return hasContent || hasSentences;
}

function flattenSentences(sentences: FirefliesSentence[]): string {
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

function extractSpeakers(sentences: FirefliesSentence[]): string[] {
  const speakers = new Set<string>();
  for (const s of sentences) {
    speakers.add(s.speaker_name);
  }
  return [...speakers];
}

function tryParseJsonContent(content: string): FirefliesSentence[] | null {
  try {
    // Try to parse as JSON array of sentences
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0];
      if (typeof first.sentence === 'string' && typeof first.speaker_name === 'string') {
        return parsed as FirefliesSentence[];
      }
    }
  } catch {
    // Not JSON, that's fine
  }
  return null;
}

export async function handleMeetings(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return;
  }

  try {
    const userId = requireUserId(req);
    const body = await parseBody(req);

    if (!isValidRequest(body)) {
      sendJson(res, 400, {
        success: false,
        error: 'Invalid request. Required: title (string), and either content (string) or sentences (array)',
      });
      return;
    }

    const db = getDb();
    const occurredAt = body.occurred_at ? new Date(body.occurred_at).toISOString() : new Date().toISOString();

    let fullContent: string;
    let speakers: string[] = [];

    // Check if content is actually JSON sentences
    if (body.content) {
      const parsedSentences = tryParseJsonContent(body.content);
      if (parsedSentences) {
        // Content was JSON sentences - flatten them
        fullContent = flattenSentences(parsedSentences);
        speakers = extractSpeakers(parsedSentences);
      } else {
        // Plain text content
        fullContent = body.content;
      }
    } else if (body.sentences) {
      // Sentences array provided directly
      fullContent = flattenSentences(body.sentences);
      speakers = extractSpeakers(body.sentences);
    } else {
      sendJson(res, 400, { success: false, error: 'No content provided' });
      return;
    }

    // Build metadata header
    const metadata: string[] = [
      `Meeting: ${body.title}`,
      `Date: ${new Date(occurredAt).toLocaleDateString()}`,
    ];

    if (speakers.length > 0) {
      metadata.push(`Participants: ${speakers.join(', ')}`);
    }

    metadata.push('', '---', '', 'TRANSCRIPT:', '');

    const contentWithMetadata = metadata.join('\n') + fullContent;

    const insert: SourceMaterialInsert = {
      user_id: userId,
      type: 'meeting',
      title: body.title,
      content: contentWithMetadata,
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

    console.log(`[Meeting] Ingested: ${body.title}`);

    sendJson(res, 201, {
      success: true,
      data: data as SourceMaterial,
    });
  } catch (err) {
    console.error('Error ingesting meeting:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
