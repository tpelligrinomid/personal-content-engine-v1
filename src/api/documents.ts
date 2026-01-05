/**
 * Documents API
 *
 * GET /api/documents      - List crawled documents (filter by source, extracted)
 * GET /api/documents/:id  - Get single document with extraction
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function sendJson(res: ServerResponse, status: number, data: ApiResponse): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function extractIdFromPath(pathname: string): string | null {
  const match = pathname.match(/\/api\/documents\/([^/]+)/);
  return match ? match[1] : null;
}

function getQueryParams(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  return url.searchParams;
}

async function handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);
    const params = getQueryParams(req);
    const sourceId = params.get('source_id');
    const extracted = params.get('extracted');
    const limit = parseInt(params.get('limit') || '50', 10);
    const offset = parseInt(params.get('offset') || '0', 10);

    const db = getDb();

    // First get documents
    let query = db
      .from('documents')
      .select('id, title, url, published_at, crawled_at, trend_source_id', { count: 'exact' })
      .eq('user_id', userId)
      .order('crawled_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (sourceId) {
      query = query.eq('trend_source_id', sourceId);
    }

    const { data: documents, error, count } = await query;

    if (error) {
      console.error('Documents query error:', error);
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    // Fetch trend_sources separately to avoid join issues
    const trendSourceIds = [...new Set(documents?.map((d: any) => d.trend_source_id).filter(Boolean) || [])];
    let trendSourcesMap: Record<string, any> = {};

    if (trendSourceIds.length > 0) {
      const { data: trendSources } = await db
        .from('trend_sources')
        .select('id, name, url')
        .in('id', trendSourceIds);

      if (trendSources) {
        trendSourcesMap = Object.fromEntries(trendSources.map((ts: any) => [ts.id, ts]));
      }
    }

    // Attach trend_sources to documents
    const docsWithSources = documents?.map((doc: any) => ({
      ...doc,
      trend_sources: trendSourcesMap[doc.trend_source_id] || null,
    })) || [];

    // If filtering by extracted status, we need to check extractions
    let filteredDocs = docsWithSources;
    if (extracted !== null) {
      const docIds = documents?.map((d: any) => d.id) || [];

      if (docIds.length > 0) {
        const { data: extractions } = await db
          .from('extractions')
          .select('document_id')
          .eq('user_id', userId)
          .in('document_id', docIds);

        const extractedIds = new Set(extractions?.map((e: any) => e.document_id) || []);

        if (extracted === 'true') {
          filteredDocs = documents?.filter((d: any) => extractedIds.has(d.id));
        } else if (extracted === 'false') {
          filteredDocs = documents?.filter((d: any) => !extractedIds.has(d.id));
        }
      }
    }

    sendJson(res, 200, {
      success: true,
      data: {
        documents: filteredDocs,
        total: count,
        limit,
        offset,
      },
    });
  } catch (err) {
    console.error('Error listing documents:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleGet(
  req: IncomingMessage,
  res: ServerResponse,
  id: string
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const db = getDb();

    // Get document with source and extraction
    const { data: document, error } = await db
      .from('documents')
      .select(`
        *,
        trend_sources (id, name, url, tier),
        extractions (id, summary, key_points, topics, extracted_at)
      `)
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        sendJson(res, 404, { success: false, error: 'Document not found' });
        return;
      }
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 200, { success: true, data: document });
  } catch (err) {
    console.error('Error fetching document:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleDocuments(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const id = extractIdFromPath(pathname);

  // List all documents
  if (pathname === '/api/documents' && req.method === 'GET') {
    return handleList(req, res);
  }

  // Single document
  if (id && req.method === 'GET') {
    return handleGet(req, res, id);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
