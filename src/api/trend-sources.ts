/**
 * Trend Sources API
 *
 * POST /api/trend-sources - Create a new trend source
 * GET /api/trend-sources - List trend sources
 * PATCH /api/trend-sources/:id - Update a trend source
 * DELETE /api/trend-sources/:id - Delete a trend source
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { TrendSource, TrendSourceInsert } from '../types';

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

function extractIdFromPath(pathname: string): string | null {
  const match = pathname.match(/\/api\/trend-sources\/([^/]+)/);
  return match ? match[1] : null;
}

async function handleCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;

    if (!body.name || typeof body.name !== 'string') {
      sendJson(res, 400, { success: false, error: 'name is required' });
      return;
    }

    const db = getDb();

    const insert: TrendSourceInsert = {
      name: body.name,
      domain: (body.domain as string) || null,
      feed_url: (body.feed_url as string) || null,
      sitemap_url: (body.sitemap_url as string) || null,
      crawl_method: (body.crawl_method as TrendSourceInsert['crawl_method']) || 'html',
      tier: typeof body.tier === 'number' ? body.tier : 2,
      status: (body.status as TrendSourceInsert['status']) || 'active',
      trust_score: typeof body.trust_score === 'number' ? body.trust_score : null,
      notes: (body.notes as string) || null,
    };

    const { data, error } = await db
      .from('trend_sources')
      .insert(insert)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to create trend source' });
      return;
    }

    sendJson(res, 201, { success: true, data: data as TrendSource });
  } catch (err) {
    console.error('Error creating trend source:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const tier = url.searchParams.get('tier');
    const status = url.searchParams.get('status');

    const db = getDb();
    let query = db
      .from('trend_sources')
      .select('*')
      .order('tier', { ascending: true })
      .order('name', { ascending: true });

    if (tier) {
      query = query.eq('tier', parseInt(tier, 10));
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to fetch trend sources' });
      return;
    }

    sendJson(res, 200, { success: true, data: data as TrendSource[] });
  } catch (err) {
    console.error('Error listing trend sources:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

async function handleUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  id: string
): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;
    const db = getDb();

    const updates: Partial<TrendSourceInsert> = {};

    if (body.name !== undefined) updates.name = body.name as string;
    if (body.domain !== undefined) updates.domain = body.domain as string;
    if (body.feed_url !== undefined) updates.feed_url = body.feed_url as string;
    if (body.sitemap_url !== undefined) updates.sitemap_url = body.sitemap_url as string;
    if (body.crawl_method !== undefined)
      updates.crawl_method = body.crawl_method as TrendSourceInsert['crawl_method'];
    if (body.tier !== undefined) updates.tier = body.tier as number;
    if (body.status !== undefined) updates.status = body.status as TrendSourceInsert['status'];
    if (body.trust_score !== undefined) updates.trust_score = body.trust_score as number;
    if (body.notes !== undefined) updates.notes = body.notes as string;

    const { data, error } = await db
      .from('trend_sources')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to update trend source' });
      return;
    }

    sendJson(res, 200, { success: true, data: data as TrendSource });
  } catch (err) {
    console.error('Error updating trend source:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleDelete(
  req: IncomingMessage,
  res: ServerResponse,
  id: string
): Promise<void> {
  try {
    const db = getDb();

    const { error } = await db.from('trend_sources').delete().eq('id', id);

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to delete trend source' });
      return;
    }

    sendJson(res, 200, { success: true, data: { deleted: id } });
  } catch (err) {
    console.error('Error deleting trend source:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

export async function handleTrendSources(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const id = extractIdFromPath(pathname);

  // Collection routes
  if (pathname === '/api/trend-sources') {
    if (req.method === 'POST') {
      return handleCreate(req, res);
    }
    if (req.method === 'GET') {
      return handleList(req, res);
    }
  }

  // Item routes
  if (id) {
    if (req.method === 'PATCH') {
      return handleUpdate(req, res, id);
    }
    if (req.method === 'DELETE') {
      return handleDelete(req, res, id);
    }
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
