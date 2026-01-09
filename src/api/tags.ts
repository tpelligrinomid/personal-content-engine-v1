/**
 * Tags API
 *
 * GET    /api/tags          - List all tags for user
 * POST   /api/tags          - Create a new tag
 * PATCH  /api/tags/:id      - Update tag (name, color, is_favorite)
 * DELETE /api/tags/:id      - Delete tag
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
import { Tag, TagInsert } from '../types';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface CreateTagRequest {
  name: string;
  color?: string;
  is_favorite?: boolean;
}

interface UpdateTagRequest {
  name?: string;
  color?: string;
  is_favorite?: boolean;
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
  const match = pathname.match(/\/api\/tags\/([^/]+)$/);
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
    const favoritesOnly = params.get('favorites_only') === 'true';
    const includeCount = params.get('include_count') === 'true';

    const db = getDb();

    let query = db
      .from('tags')
      .select('*')
      .eq('user_id', userId)
      .order('is_favorite', { ascending: false })
      .order('name', { ascending: true });

    if (favoritesOnly) {
      query = query.eq('is_favorite', true);
    }

    const { data: tags, error } = await query;

    if (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    // If include_count requested, get usage counts
    let tagsWithCount = tags;
    if (includeCount && tags && tags.length > 0) {
      const tagIds = tags.map((t: Tag) => t.id);
      const { data: counts } = await db
        .from('asset_tags')
        .select('tag_id')
        .eq('user_id', userId)
        .in('tag_id', tagIds);

      const countMap: Record<string, number> = {};
      counts?.forEach((c: { tag_id: string }) => {
        countMap[c.tag_id] = (countMap[c.tag_id] || 0) + 1;
      });

      tagsWithCount = tags.map((t: Tag) => ({
        ...t,
        asset_count: countMap[t.id] || 0,
      }));
    }

    sendJson(res, 200, { success: true, data: tagsWithCount });
  } catch (err) {
    console.error('Error listing tags:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = (await parseBody(req)) as CreateTagRequest;

    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      sendJson(res, 400, { success: false, error: 'Tag name is required' });
      return;
    }

    const db = getDb();

    // Check for duplicate name
    const { data: existing } = await db
      .from('tags')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', body.name.trim())
      .limit(1);

    if (existing && existing.length > 0) {
      sendJson(res, 400, { success: false, error: 'A tag with this name already exists' });
      return;
    }

    const insert: TagInsert = {
      user_id: userId,
      name: body.name.trim(),
      color: body.color || '#6B7280',
      is_favorite: body.is_favorite || false,
    };

    const { data, error } = await db
      .from('tags')
      .insert(insert)
      .select()
      .single();

    if (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 201, { success: true, data });
  } catch (err) {
    console.error('Error creating tag:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  id: string
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = (await parseBody(req)) as UpdateTagRequest;

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        sendJson(res, 400, { success: false, error: 'Tag name cannot be empty' });
        return;
      }
      updates.name = body.name.trim();
    }

    if (body.color !== undefined) {
      updates.color = body.color;
    }

    if (body.is_favorite !== undefined) {
      updates.is_favorite = body.is_favorite;
    }

    if (Object.keys(updates).length === 0) {
      sendJson(res, 400, { success: false, error: 'No valid fields to update' });
      return;
    }

    const db = getDb();

    // If updating name, check for duplicates
    if (updates.name) {
      const { data: existing } = await db
        .from('tags')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', updates.name as string)
        .neq('id', id)
        .limit(1);

      if (existing && existing.length > 0) {
        sendJson(res, 400, { success: false, error: 'A tag with this name already exists' });
        return;
      }
    }

    const { data, error } = await db
      .from('tags')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        sendJson(res, 404, { success: false, error: 'Tag not found' });
        return;
      }
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 200, { success: true, data });
  } catch (err) {
    console.error('Error updating tag:', err);
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
    const userId = requireUserId(req);
    const db = getDb();

    // Delete asset_tags first (foreign key)
    await db
      .from('asset_tags')
      .delete()
      .eq('tag_id', id)
      .eq('user_id', userId);

    // Delete the tag
    const { error } = await db
      .from('tags')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 200, { success: true, data: { message: 'Tag deleted successfully' } });
  } catch (err) {
    console.error('Error deleting tag:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleTags(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const id = extractIdFromPath(pathname);

  // List all tags
  if (pathname === '/api/tags' && req.method === 'GET') {
    return handleList(req, res);
  }

  // Create new tag
  if (pathname === '/api/tags' && req.method === 'POST') {
    return handleCreate(req, res);
  }

  // Update tag
  if (id && req.method === 'PATCH') {
    return handleUpdate(req, res, id);
  }

  // Delete tag
  if (id && req.method === 'DELETE') {
    return handleDelete(req, res, id);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
