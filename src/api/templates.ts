/**
 * Templates API
 *
 * GET /api/templates - List all available templates
 * GET /api/templates/:key - Get specific template with prompt
 * PUT /api/templates/:key - Create or update template override
 * DELETE /api/templates/:key - Remove override (revert to default)
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
import {
  getAvailableTemplates,
  getTemplateInfo,
  isValidTemplateKey,
} from '../services/templates';
import { TemplateInsert } from '../types';

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

function extractKeyFromPath(pathname: string): string | null {
  const match = pathname.match(/\/api\/templates\/([^/]+)/);
  return match ? match[1] : null;
}

async function handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const templates = getAvailableTemplates();
  sendJson(res, 200, { success: true, data: templates });
}

async function handleGet(
  req: IncomingMessage,
  res: ServerResponse,
  key: string
): Promise<void> {
  if (!isValidTemplateKey(key)) {
    sendJson(res, 404, { success: false, error: `Unknown template: ${key}` });
    return;
  }

  // Get userId to check for user-specific overrides
  const userId = requireUserId(req);
  const template = await getTemplateInfo(key, userId);

  if (!template) {
    sendJson(res, 404, { success: false, error: 'Template not found' });
    return;
  }

  sendJson(res, 200, { success: true, data: template });
}

async function handleUpsert(
  req: IncomingMessage,
  res: ServerResponse,
  key: string
): Promise<void> {
  if (!isValidTemplateKey(key)) {
    sendJson(res, 404, { success: false, error: `Unknown template key: ${key}` });
    return;
  }

  try {
    const userId = requireUserId(req);
    const body = (await parseBody(req)) as Record<string, unknown>;

    if (!body.prompt || typeof body.prompt !== 'string') {
      sendJson(res, 400, { success: false, error: 'prompt is required' });
      return;
    }

    const db = getDb();

    // Check if override exists for this user (use maybeSingle to avoid error on no rows)
    const { data: existing } = await db
      .from('templates')
      .select('id')
      .eq('user_id', userId)
      .eq('template_key', key)
      .maybeSingle();

    const templateData = {
      name: (body.name as string) || key,
      description: (body.description as string) || null,
      prompt: body.prompt,
      active: body.active !== false,
    };

    let result;
    let isUpdate = false;

    if (existing) {
      // Update existing user override
      isUpdate = true;
      const { data, error } = await db
        .from('templates')
        .update(templateData)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        sendJson(res, 500, { success: false, error: error.message });
        return;
      }
      result = data;
    } else {
      // Insert new user override
      const insert: TemplateInsert = {
        user_id: userId,
        template_key: key,
        ...templateData,
      };

      const { data, error } = await db
        .from('templates')
        .insert(insert)
        .select()
        .single();

      if (error) {
        // If unique constraint error, the DB constraint might be wrong
        // Try to provide helpful error message
        if (error.message.includes('unique constraint')) {
          console.error(`[Templates] Unique constraint error for user ${userId}, key ${key}. Check DB constraint.`);
          sendJson(res, 500, {
            success: false,
            error: 'Template constraint error. The database may need a migration to support per-user templates.'
          });
          return;
        }
        sendJson(res, 500, { success: false, error: error.message });
        return;
      }
      result = data;
    }

    sendJson(res, 200, {
      success: true,
      data: {
        ...result,
        message: isUpdate ? 'Template override updated' : 'Template override created',
      },
    });
  } catch (err) {
    console.error('Error upserting template:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleDelete(
  req: IncomingMessage,
  res: ServerResponse,
  key: string
): Promise<void> {
  if (!isValidTemplateKey(key)) {
    sendJson(res, 404, { success: false, error: `Unknown template key: ${key}` });
    return;
  }

  try {
    const userId = requireUserId(req);
    const db = getDb();

    const { error } = await db
      .from('templates')
      .delete()
      .eq('user_id', userId)
      .eq('template_key', key);

    if (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 200, {
      success: true,
      data: { message: `Override removed for ${key}, using default prompt` },
    });
  } catch (err) {
    console.error('Error deleting template:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleTemplates(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const key = extractKeyFromPath(pathname);

  // List all templates
  if (pathname === '/api/templates' && req.method === 'GET') {
    return handleList(req, res);
  }

  // Single template operations
  if (key) {
    if (req.method === 'GET') {
      return handleGet(req, res, key);
    }
    if (req.method === 'PUT') {
      return handleUpsert(req, res, key);
    }
    if (req.method === 'DELETE') {
      return handleDelete(req, res, key);
    }
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
