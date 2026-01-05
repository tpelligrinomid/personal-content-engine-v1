/**
 * Admin Templates API
 *
 * GET    /api/admin/templates          - List all system templates with override status
 * GET    /api/admin/templates/:key     - Get system template with code default
 * PUT    /api/admin/templates/:key     - Update system template (creates/updates user_id=NULL record)
 * DELETE /api/admin/templates/:key     - Reset to code default (deletes user_id=NULL record)
 *
 * All endpoints require admin role.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId, requireAdmin } from '../middleware/auth';
import {
  getAvailableTemplates,
  getCodeDefaultPrompt,
  isValidTemplateKey,
} from '../services/templates';

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
  const match = pathname.match(/\/api\/admin\/templates\/([^/]+)$/);
  return match ? match[1] : null;
}

async function handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    requireAdmin(req);
    const db = getDb();

    // Get all template definitions
    const templates = getAvailableTemplates();

    // Check which ones have system overrides
    const { data: systemOverrides } = await db
      .from('templates')
      .select('template_key, name, description, updated_at')
      .is('user_id', null)
      .eq('active', true);

    const overrideMap = new Map(
      (systemOverrides || []).map((o: any) => [o.template_key, o])
    );

    // Combine info
    const result = templates.map((t) => {
      const override = overrideMap.get(t.key);
      return {
        ...t,
        hasSystemOverride: !!override,
        systemOverrideName: override?.name || null,
        systemOverrideDescription: override?.description || null,
        lastModified: override?.updated_at || null,
      };
    });

    sendJson(res, 200, { success: true, data: result });
  } catch (err) {
    console.error('Error listing admin templates:', err);
    if (err instanceof Error && err.message === 'Admin access required') {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

async function handleGet(
  req: IncomingMessage,
  res: ServerResponse,
  templateKey: string
): Promise<void> {
  try {
    requireAdmin(req);

    if (!isValidTemplateKey(templateKey)) {
      sendJson(res, 404, { success: false, error: 'Unknown template key' });
      return;
    }

    const db = getDb();
    const templates = getAvailableTemplates();
    const templateDef = templates.find((t) => t.key === templateKey);

    // Get system override if exists
    const { data: systemOverride } = await db
      .from('templates')
      .select('*')
      .eq('template_key', templateKey)
      .is('user_id', null)
      .eq('active', true)
      .single();

    const codeDefault = getCodeDefaultPrompt(templateKey);

    sendJson(res, 200, {
      success: true,
      data: {
        key: templateKey,
        name: systemOverride?.name || templateDef?.name,
        description: systemOverride?.description || templateDef?.description,
        suggestedInputs: templateDef?.suggestedInputs,
        prompt: systemOverride?.prompt || codeDefault,
        codeDefault,
        hasSystemOverride: !!systemOverride,
        lastModified: systemOverride?.updated_at || null,
      },
    });
  } catch (err) {
    console.error('Error fetching admin template:', err);
    if (err instanceof Error && err.message === 'Admin access required') {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

async function handleUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  templateKey: string
): Promise<void> {
  try {
    requireAdmin(req);

    if (!isValidTemplateKey(templateKey)) {
      sendJson(res, 404, { success: false, error: 'Unknown template key' });
      return;
    }

    const body = (await parseBody(req)) as {
      name?: string;
      description?: string;
      prompt?: string;
    };

    if (!body.prompt && !body.name && !body.description) {
      sendJson(res, 400, {
        success: false,
        error: 'At least one field required: name, description, or prompt',
      });
      return;
    }

    const db = getDb();
    const templates = getAvailableTemplates();
    const templateDef = templates.find((t) => t.key === templateKey);

    // Check if system override already exists
    const { data: existing } = await db
      .from('templates')
      .select('id')
      .eq('template_key', templateKey)
      .is('user_id', null)
      .single();

    let result;

    if (existing) {
      // Update existing system override
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.description !== undefined) updates.description = body.description;
      if (body.prompt !== undefined) updates.prompt = body.prompt;

      const { data, error } = await db
        .from('templates')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        sendJson(res, 500, { success: false, error: error.message });
        return;
      }
      result = data;
    } else {
      // Create new system override
      const { data, error } = await db
        .from('templates')
        .insert({
          user_id: null, // System default
          template_key: templateKey,
          name: body.name || templateDef?.name,
          description: body.description || templateDef?.description,
          prompt: body.prompt || getCodeDefaultPrompt(templateKey),
          active: true,
        })
        .select()
        .single();

      if (error) {
        sendJson(res, 500, { success: false, error: error.message });
        return;
      }
      result = data;
    }

    console.log(`[Admin] Updated system template: ${templateKey}`);

    sendJson(res, 200, {
      success: true,
      data: {
        ...result,
        codeDefault: getCodeDefaultPrompt(templateKey),
      },
    });
  } catch (err) {
    console.error('Error updating admin template:', err);
    if (err instanceof Error && err.message === 'Admin access required') {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

async function handleReset(
  req: IncomingMessage,
  res: ServerResponse,
  templateKey: string
): Promise<void> {
  try {
    requireAdmin(req);

    if (!isValidTemplateKey(templateKey)) {
      sendJson(res, 404, { success: false, error: 'Unknown template key' });
      return;
    }

    const db = getDb();

    // Delete system override (user_id IS NULL)
    const { error } = await db
      .from('templates')
      .delete()
      .eq('template_key', templateKey)
      .is('user_id', null);

    if (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    console.log(`[Admin] Reset system template to code default: ${templateKey}`);

    sendJson(res, 200, {
      success: true,
      data: {
        key: templateKey,
        message: 'Reset to code default',
        codeDefault: getCodeDefaultPrompt(templateKey),
      },
    });
  } catch (err) {
    console.error('Error resetting admin template:', err);
    if (err instanceof Error && err.message === 'Admin access required') {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

export async function handleAdminTemplates(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const templateKey = extractKeyFromPath(pathname);

  // GET /api/admin/templates - List all
  if (pathname === '/api/admin/templates' && req.method === 'GET') {
    return handleList(req, res);
  }

  // Operations on specific template
  if (templateKey) {
    // GET /api/admin/templates/:key
    if (req.method === 'GET') {
      return handleGet(req, res, templateKey);
    }

    // PUT /api/admin/templates/:key
    if (req.method === 'PUT') {
      return handleUpdate(req, res, templateKey);
    }

    // DELETE /api/admin/templates/:key - Reset to code default
    if (req.method === 'DELETE') {
      return handleReset(req, res, templateKey);
    }
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
