/**
 * Voice Notes API
 *
 * POST /api/ingest/voice-note - Ingest a voice note transcript
 *
 * Accepts transcribed text from Wispr or similar tools
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
import { extractFromContent, EXTRACTION_MODEL } from '../services/claude';
import { SourceMaterial, SourceMaterialInsert, ExtractionInsert } from '../types';

interface VoiceNoteRequest {
  title?: string;
  content: string;
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

function validateRequest(body: unknown): body is VoiceNoteRequest {
  if (typeof body !== 'object' || body === null) return false;

  const obj = body as Record<string, unknown>;

  if (typeof obj.content !== 'string' || obj.content.trim().length === 0) {
    return false;
  }

  return true;
}

function generateTitle(content: string): string {
  const preview = content.slice(0, 50).trim();
  if (preview.length > 0) {
    return preview + (content.length > 50 ? '...' : '');
  }
  return `Voice Note - ${new Date().toLocaleDateString()}`;
}

async function handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = await parseBody(req);

    if (!validateRequest(body)) {
      sendJson(res, 400, {
        success: false,
        error: 'Invalid request. Required: content (string)',
      });
      return;
    }

    const db = getDb();

    const title = body.title || generateTitle(body.content);
    const occurredAt = body.occurred_at || new Date().toISOString();

    const insert: SourceMaterialInsert = {
      user_id: userId,
      type: 'voice_note',
      title,
      content: body.content,
      source_url: null,
      occurred_at: occurredAt,
    };

    const { data, error } = await db
      .from('source_materials')
      .insert(insert)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to save voice note' });
      return;
    }

    const sourceMaterial = data as SourceMaterial;

    // Auto-extract from the content
    let extraction = null;
    try {
      console.log(`[VoiceNote] Auto-extracting: ${sourceMaterial.title}`);
      const extractionResult = await extractFromContent(body.content, 'voice_note');

      const extractionInsert: ExtractionInsert = {
        user_id: userId,
        source_material_id: sourceMaterial.id,
        document_id: null,
        summary: extractionResult.summary,
        key_points: extractionResult.key_points,
        topics: extractionResult.topics,
        model: EXTRACTION_MODEL,
      };

      const { data: extractionData, error: extractionError } = await db
        .from('extractions')
        .insert(extractionInsert)
        .select()
        .single();

      if (extractionError) {
        console.error('[VoiceNote] Extraction save failed:', extractionError);
      } else {
        extraction = extractionData;
        console.log(`[VoiceNote] Extraction created: ${extraction.id}`);
      }
    } catch (extractErr) {
      console.error('[VoiceNote] Auto-extraction failed:', extractErr);
    }

    sendJson(res, 201, {
      success: true,
      data: {
        source_material: sourceMaterial,
        extraction,
      },
    });
  } catch (err) {
    console.error('Error ingesting voice note:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleVoiceNotes(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handleIngest(req, res);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
