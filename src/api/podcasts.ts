/**
 * Podcasts API
 *
 * POST /api/ingest/podcast - Ingest a podcast episode transcript
 *
 * Accepts transcribed text from podcast episodes
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
import { extractFromContent, EXTRACTION_MODEL } from '../services/claude';
import { SourceMaterial, SourceMaterialInsert, ExtractionInsert } from '../types';

interface PodcastRequest {
  title: string;
  content: string;
  source_url?: string;
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

function validateRequest(body: unknown): body is PodcastRequest {
  if (typeof body !== 'object' || body === null) return false;

  const obj = body as Record<string, unknown>;

  if (typeof obj.title !== 'string' || obj.title.trim().length === 0) {
    return false;
  }

  if (typeof obj.content !== 'string' || obj.content.trim().length === 0) {
    return false;
  }

  return true;
}

async function handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = await parseBody(req);

    if (!validateRequest(body)) {
      sendJson(res, 400, {
        success: false,
        error: 'Invalid request. Required: title (string), content (string)',
      });
      return;
    }

    const db = getDb();

    const occurredAt = body.occurred_at || new Date().toISOString();

    const insert: SourceMaterialInsert = {
      user_id: userId,
      type: 'podcast',
      title: body.title,
      content: body.content,
      source_url: body.source_url || null,
      occurred_at: occurredAt,
    };

    const { data, error } = await db
      .from('source_materials')
      .insert(insert)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to save podcast transcript' });
      return;
    }

    const sourceMaterial = data as SourceMaterial;

    // Auto-extract from the content
    let extraction = null;
    try {
      console.log(`[Podcast] Auto-extracting: ${sourceMaterial.title}`);
      const extractionResult = await extractFromContent(body.content, 'podcast');

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
        console.error('[Podcast] Extraction save failed:', extractionError);
      } else {
        extraction = extractionData;
        console.log(`[Podcast] Extraction created: ${extraction.id}`);
      }
    } catch (extractErr) {
      console.error('[Podcast] Auto-extraction failed:', extractErr);
    }

    sendJson(res, 201, {
      success: true,
      data: {
        source_material: sourceMaterial,
        extraction,
      },
    });
  } catch (err) {
    console.error('Error ingesting podcast:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handlePodcasts(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handleIngest(req, res);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
