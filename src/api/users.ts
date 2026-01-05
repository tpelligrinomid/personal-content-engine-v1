/**
 * Users API (Admin Only)
 *
 * GET /api/users - List all users (admin only)
 * GET /api/users/:id - Get user details (admin only)
 * PATCH /api/users/:id - Update user role (admin only)
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId, isAdmin } from '../middleware/auth';
import { UserSettings } from '../types';

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
  const match = pathname.match(/\/api\/users\/([^/]+)/);
  return match ? match[1] : null;
}

async function handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // Admin check
    if (!isAdmin(req)) {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }

    const db = getDb();

    const { data, error } = await db
      .from('user_settings')
      .select('id, user_id, role, crawl_enabled, generation_enabled, content_formats, timezone, last_crawl_at, last_generation_at, created_at')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to fetch users' });
      return;
    }

    sendJson(res, 200, { success: true, data });
  } catch (err) {
    console.error('Error listing users:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

async function handleGet(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string
): Promise<void> {
  try {
    // Admin check
    if (!isAdmin(req)) {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }

    const db = getDb();

    const { data, error } = await db
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      sendJson(res, 404, { success: false, error: 'User not found' });
      return;
    }

    // Get user's content counts
    const [sourceMaterials, documents, assets, trendSources] = await Promise.all([
      db.from('source_materials').select('id', { count: 'exact' }).eq('user_id', userId),
      db.from('documents').select('id', { count: 'exact' }).eq('user_id', userId),
      db.from('assets').select('id', { count: 'exact' }).eq('user_id', userId),
      db.from('trend_sources').select('id', { count: 'exact' }).eq('user_id', userId),
    ]);

    sendJson(res, 200, {
      success: true,
      data: {
        ...data,
        counts: {
          source_materials: sourceMaterials.count || 0,
          documents: documents.count || 0,
          assets: assets.count || 0,
          trend_sources: trendSources.count || 0,
        },
      },
    });
  } catch (err) {
    console.error('Error getting user:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

async function handleUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string
): Promise<void> {
  try {
    // Admin check
    if (!isAdmin(req)) {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }

    const body = (await parseBody(req)) as Record<string, unknown>;
    const db = getDb();

    const updates: Partial<UserSettings> = {};

    // Only allow updating role (other settings can be updated by user themselves)
    if (body.role !== undefined) {
      if (!['admin', 'user'].includes(body.role as string)) {
        sendJson(res, 400, { success: false, error: 'Invalid role. Must be "admin" or "user"' });
        return;
      }
      updates.role = body.role as 'admin' | 'user';
    }

    if (Object.keys(updates).length === 0) {
      sendJson(res, 400, { success: false, error: 'No valid fields to update' });
      return;
    }

    const { data, error } = await db
      .from('user_settings')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to update user' });
      return;
    }

    sendJson(res, 200, { success: true, data });
  } catch (err) {
    console.error('Error updating user:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

export async function handleUsers(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const userId = extractIdFromPath(pathname);

  // List all users
  if (pathname === '/api/users' && req.method === 'GET') {
    return handleList(req, res);
  }

  // Single user operations
  if (userId) {
    if (req.method === 'GET') {
      return handleGet(req, res, userId);
    }
    if (req.method === 'PATCH') {
      return handleUpdate(req, res, userId);
    }
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
