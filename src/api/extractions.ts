/**
 * Extractions API
 *
 * POST /api/extractions - Create extraction from a source material or document
 * GET /api/extractions - List extractions (with optional filters)
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
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
  message?: string;
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
    const userId = requireUserId(req);
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
    let contentType: 'meeting' | 'voice_note' | 'trend' | 'manual_note' | 'podcast' | 'document';

    if (body.source_material_id) {
      const { data: sourceMaterial, error } = await db
        .from('source_materials')
        .select('*')
        .eq('id', body.source_material_id)
        .eq('user_id', userId)
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
        .eq('user_id', userId)
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
    let existingQuery = db.from('extractions').select('*').eq('user_id', userId);
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
      user_id: userId,
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
    const userId = requireUserId(req);
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit') ?? '0', 10);
    const source = url.searchParams.get('source') || 'all'; // 'source_materials', 'documents', or 'all'

    const db = getDb();
    const results: Extraction[] = [];
    const errors: string[] = [];
    let totalRemaining = 0;
    let totalSkipped = 0;

    // Process source materials
    if (source === 'all' || source === 'source_materials') {
      const { data: sourceMaterials } = await db
        .from('source_materials')
        .select('id, type, content, title')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      const { data: existingSM } = await db
        .from('extractions')
        .select('source_material_id')
        .eq('user_id', userId)
        .not('source_material_id', 'is', null);

      const existingSmIds = new Set(
        (existingSM ?? []).map((e: { source_material_id: string | null }) => e.source_material_id)
      );

      let smToProcess = (sourceMaterials ?? []).filter(
        (sm: { id: string }) => !existingSmIds.has(sm.id)
      );

      totalSkipped += existingSmIds.size;
      totalRemaining += smToProcess.length;

      if (limit > 0 && smToProcess.length > limit) {
        smToProcess = smToProcess.slice(0, limit);
      }

      for (const sm of smToProcess as SourceMaterial[]) {
        try {
          console.log(`Extracting source material: ${sm.title} (${sm.type})`);
          const extractionResult = await extractFromContent(sm.content, sm.type);

          const insert: ExtractionInsert = {
            user_id: userId,
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
            errors.push(`[SM] ${sm.title}: ${error.message}`);
          } else {
            results.push(data as Extraction);
          }
        } catch (err) {
          errors.push(`[SM] ${sm.title}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }

    // Process documents
    if (source === 'all' || source === 'documents') {
      const { data: documents } = await db
        .from('documents')
        .select('id, title, raw_text')
        .eq('user_id', userId)
        .eq('status', 'parsed')
        .not('raw_text', 'is', null)
        .order('created_at', { ascending: true });

      const { data: existingDocs } = await db
        .from('extractions')
        .select('document_id')
        .eq('user_id', userId)
        .not('document_id', 'is', null);

      const existingDocIds = new Set(
        (existingDocs ?? []).map((e: { document_id: string | null }) => e.document_id)
      );

      let docsToProcess = (documents ?? []).filter(
        (doc: { id: string }) => !existingDocIds.has(doc.id)
      );

      totalSkipped += existingDocIds.size;
      totalRemaining += docsToProcess.length;

      const remainingLimit = limit > 0 ? limit - results.length : 0;
      if (remainingLimit > 0 && docsToProcess.length > remainingLimit) {
        docsToProcess = docsToProcess.slice(0, remainingLimit);
      } else if (limit > 0 && results.length >= limit) {
        docsToProcess = [];
      }

      for (const doc of docsToProcess as { id: string; title: string | null; raw_text: string }[]) {
        try {
          console.log(`Extracting document: ${doc.title || doc.id}`);
          const extractionResult = await extractFromContent(doc.raw_text, 'document');

          const insert: ExtractionInsert = {
            user_id: userId,
            source_material_id: null,
            document_id: doc.id,
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
            errors.push(`[Doc] ${doc.title || doc.id}: ${error.message}`);
          } else {
            results.push(data as Extraction);
          }
        } catch (err) {
          errors.push(`[Doc] ${doc.title || doc.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }

    sendJson(res, 200, {
      success: true,
      data: {
        processed: results.length,
        remaining: totalRemaining - results.length,
        skipped: totalSkipped,
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
    const userId = requireUserId(req);
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const sourceMaterialId = url.searchParams.get('source_material_id');
    const documentId = url.searchParams.get('document_id');
    const sourceType = url.searchParams.get('source_type'); // Filter: meeting, podcast, voice_note, manual_note, trend, document
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const includeArchived = url.searchParams.get('include_archived') === 'true';
    const archivedOnly = url.searchParams.get('archived_only') === 'true';

    const db = getDb();

    // First get extractions
    let query = db
      .from('extractions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (sourceMaterialId) {
      query = query.eq('source_material_id', sourceMaterialId);
    }
    if (documentId) {
      query = query.eq('document_id', documentId);
    }

    // Archive filtering
    if (archivedOnly) {
      query = query.not('archived_at', 'is', null);
    } else if (!includeArchived) {
      query = query.is('archived_at', null);
    }

    // Pre-filter by source type if looking for documents only
    if (sourceType === 'document') {
      query = query.not('document_id', 'is', null);
    } else if (sourceType && sourceType !== 'document') {
      // For source material types, filter to only those with source_material_id
      query = query.not('source_material_id', 'is', null);
    }

    const { data: extractions, error } = await query;

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to fetch extractions' });
      return;
    }

    // Get source material types for extractions that have source_material_id
    const smIds = (extractions ?? [])
      .map((e: any) => e.source_material_id)
      .filter(Boolean);

    let sourceMaterialTypes: Record<string, { type: string; title: string | null }> = {};
    if (smIds.length > 0) {
      const { data: sourceMaterials } = await db
        .from('source_materials')
        .select('id, type, title')
        .in('id', smIds);

      if (sourceMaterials) {
        sourceMaterialTypes = Object.fromEntries(
          sourceMaterials.map((sm: any) => [sm.id, { type: sm.type, title: sm.title }])
        );
      }
    }

    // Get document titles for extractions that have document_id
    const docIds = (extractions ?? [])
      .map((e: any) => e.document_id)
      .filter(Boolean);

    let documentInfo: Record<string, { title: string | null }> = {};
    if (docIds.length > 0) {
      const { data: documents } = await db
        .from('documents')
        .select('id, title')
        .in('id', docIds);

      if (documents) {
        documentInfo = Object.fromEntries(
          documents.map((doc: any) => [doc.id, { title: doc.title }])
        );
      }
    }

    // Enrich extractions with source_type and source_title
    let enrichedExtractions = (extractions ?? []).map((extraction: any) => {
      if (extraction.source_material_id && sourceMaterialTypes[extraction.source_material_id]) {
        return {
          ...extraction,
          source_type: sourceMaterialTypes[extraction.source_material_id].type,
          source_title: sourceMaterialTypes[extraction.source_material_id].title,
        };
      } else if (extraction.document_id) {
        return {
          ...extraction,
          source_type: 'document',
          source_title: documentInfo[extraction.document_id]?.title || null,
        };
      }
      return {
        ...extraction,
        source_type: 'unknown',
        source_title: null,
      };
    });

    // Post-filter by specific source material type if needed
    if (sourceType && sourceType !== 'document') {
      enrichedExtractions = enrichedExtractions.filter(
        (e: any) => e.source_type === sourceType
      );
    }

    sendJson(res, 200, { success: true, data: enrichedExtractions });
  } catch (err) {
    console.error('Error listing extractions:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

function extractIdFromPath(pathname: string): { id: string | null; action: string | null } {
  const match = pathname.match(/\/api\/extractions\/([^/]+)(?:\/(archive|unarchive))?$/);
  if (match) {
    return { id: match[1], action: match[2] || null };
  }
  return { id: null, action: null };
}

async function handleArchive(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  archive: boolean
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const db = getDb();

    const { data, error } = await db
      .from('extractions')
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        sendJson(res, 404, { success: false, error: 'Extraction not found' });
        return;
      }
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 200, {
      success: true,
      data,
      message: archive ? 'Archived successfully' : 'Unarchived successfully',
    });
  } catch (err) {
    console.error('Error archiving extraction:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

export async function handleExtractions(
  req: IncomingMessage,
  res: ServerResponse,
  pathname?: string
): Promise<void> {
  const path = pathname || '/api/extractions';
  const { id, action } = extractIdFromPath(path);

  // POST /api/extractions - Create new
  if (path === '/api/extractions' && req.method === 'POST') {
    return handleCreate(req, res);
  }

  // GET /api/extractions - List all
  if (path === '/api/extractions' && req.method === 'GET') {
    return handleList(req, res);
  }

  // POST /api/extractions/:id/archive
  if (id && action === 'archive' && req.method === 'POST') {
    return handleArchive(req, res, id, true);
  }

  // POST /api/extractions/:id/unarchive
  if (id && action === 'unarchive' && req.method === 'POST') {
    return handleArchive(req, res, id, false);
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
