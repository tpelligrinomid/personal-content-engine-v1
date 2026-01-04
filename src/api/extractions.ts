/**
 * Extractions API
 *
 * POST /api/extractions - Create extraction from a source material or document
 * GET /api/extractions - List extractions (with optional filters)
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { extractFromContent, EXTRACTION_MODEL } from '../services/claude';
import { Extraction, ExtractionInsert, SourceMaterial } from '../types';

interface CreateExtractionRequest {
  source_material_id?: string;
  document_id?: string;
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

function validateCreateRequest(body: unknown): body is CreateExtractionRequest {
  if (typeof body !== 'object' || body === null) return false;

  const obj = body as Record<string, unknown>;

  const hasSourceMaterial = typeof obj.source_material_id === 'string';
  const hasDocument = typeof obj.document_id === 'string';

  if (!hasSourceMaterial && !hasDocument) return false;

  return true;
}

async function handleCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseBody(req);

    if (!validateCreateRequest(body)) {
      sendJson(res, 400, {
        success: false,
        error: 'Invalid request. Required: source_material_id or document_id',
      });
      return;
    }

    const db = getDb();
    let content: string;
    let contentType: 'meeting' | 'voice_note' | 'trend' | 'manual_note' | 'document';

    if (body.source_material_id) {
      const { data: sourceMaterial, error } = await db
        .from('source_materials')
        .select('*')
        .eq('id', body.source_material_id)
        .single();

      if (error || !sourceMaterial) {
        sendJson(res, 404, { success: false, error: 'Source material not found' });
        return;
      }

      content = (sourceMaterial as SourceMaterial).content;
      contentType = (sourceMaterial as SourceMaterial).type;
    } else if (body.document_id) {
      const { data: document, error } = await db
        .from('documents')
        .select('*')
        .eq('id', body.document_id)
        .single();

      if (error || !document) {
        sendJson(res, 404, { success: false, error: 'Document not found' });
        return;
      }

      content = (document as { raw_text: string }).raw_text;
      contentType = 'document';

      if (!content) {
        sendJson(res, 400, { success: false, error: 'Document has no raw_text content' });
        return;
      }
    } else {
      sendJson(res, 400, { success: false, error: 'No source specified' });
      return;
    }

    // Check for existing extraction
    let existingQuery = db.from('extractions').select('*');
    if (body.source_material_id) {
      existingQuery = existingQuery.eq('source_material_id', body.source_material_id);
    } else {
      existingQuery = existingQuery.eq('document_id', body.document_id);
    }

    const { data: existing } = await existingQuery.single();
    if (existing) {
      sendJson(res, 200, {
        success: true,
        data: existing as Extraction,
      });
      return;
    }

    // Extract using Claude
    console.log(`Extracting from ${contentType} (${content.length} chars)...`);
    const extractionResult = await extractFromContent(content, contentType);

    const insert: ExtractionInsert = {
      source_material_id: body.source_material_id ?? null,
      document_id: body.document_id ?? null,
      summary: extractionResult.summary,
      key_points: extractionResult.key_points,
      topics: extractionResult.topics,
      model: EXTRACTION_MODEL,
    };

    const { data, error } = await db
      .from('extractions')
      .insert(insert)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to save extraction' });
      return;
    }

    sendJson(res, 201, { success: true, data: data as Extraction });
  } catch (err) {
    console.error('Error creating extraction:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleBatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const db = getDb();

    // Get all source materials
    const { data: sourceMaterials, error: smError } = await db
      .from('source_materials')
      .select('id, type, content, title')
      .order('created_at', { ascending: true });

    if (smError) {
      sendJson(res, 500, { success: false, error: 'Failed to fetch source materials' });
      return;
    }

    if (!sourceMaterials || sourceMaterials.length === 0) {
      sendJson(res, 200, {
        success: true,
        data: { processed: 0, skipped: 0, errors: [], message: 'No source materials found' },
      });
      return;
    }

    // Get existing extractions
    const { data: existingExtractions } = await db
      .from('extractions')
      .select('source_material_id');

    const existingIds = new Set(
      (existingExtractions ?? []).map((e: { source_material_id: string | null }) => e.source_material_id)
    );

    // Filter to unprocessed
    const toProcess = (sourceMaterials as SourceMaterial[]).filter((sm) => !existingIds.has(sm.id));

    if (toProcess.length === 0) {
      sendJson(res, 200, {
        success: true,
        data: {
          processed: 0,
          skipped: sourceMaterials.length,
          errors: [],
          message: 'All source materials already have extractions',
        },
      });
      return;
    }

    console.log(`Batch extracting ${toProcess.length} source materials...`);

    const results: Extraction[] = [];
    const errors: string[] = [];

    for (const sm of toProcess) {
      try {
        console.log(`Extracting: ${sm.title} (${sm.type}, ${sm.content.length} chars)`);
        const extractionResult = await extractFromContent(sm.content, sm.type);

        const insert: ExtractionInsert = {
          source_material_id: sm.id,
          document_id: null,
          summary: extractionResult.summary,
          key_points: extractionResult.key_points,
          topics: extractionResult.topics,
          model: EXTRACTION_MODEL,
        };

        const { data, error } = await db
          .from('extractions')
          .insert(insert)
          .select()
          .single();

        if (error) {
          errors.push(`${sm.title}: ${error.message}`);
        } else {
          results.push(data as Extraction);
        }
      } catch (err) {
        errors.push(`${sm.title}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    sendJson(res, 200, {
      success: true,
      data: {
        processed: results.length,
        skipped: existingIds.size,
        errors,
        extractions: results,
      },
    });
  } catch (err) {
    console.error('Error in batch extraction:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const sourceMaterialId = url.searchParams.get('source_material_id');
    const documentId = url.searchParams.get('document_id');
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

    const db = getDb();
    let query = db
      .from('extractions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (sourceMaterialId) {
      query = query.eq('source_material_id', sourceMaterialId);
    }
    if (documentId) {
      query = query.eq('document_id', documentId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to fetch extractions' });
      return;
    }

    sendJson(res, 200, { success: true, data: data as Extraction[] });
  } catch (err) {
    console.error('Error listing extractions:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

export async function handleExtractions(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handleCreate(req, res);
  }

  if (req.method === 'GET') {
    return handleList(req, res);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}

export async function handleExtractionsBatch(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handleBatch(req, res);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
