/**
 * Asset Tags API
 *
 * GET    /api/assets/:id/tags           - Get tags for an asset
 * POST   /api/assets/:id/tags           - Add tag(s) to asset
 * DELETE /api/assets/:id/tags/:tagId    - Remove tag from asset
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface AddTagsRequest {
  tag_ids: string[];
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

// Extract asset ID and optional tag ID from path
// /api/assets/:assetId/tags -> { assetId, tagId: null }
// /api/assets/:assetId/tags/:tagId -> { assetId, tagId }
function extractIdsFromPath(pathname: string): { assetId: string | null; tagId: string | null } {
  const match = pathname.match(/\/api\/assets\/([^/]+)\/tags(?:\/([^/]+))?$/);
  if (match) {
    return { assetId: match[1], tagId: match[2] || null };
  }
  return { assetId: null, tagId: null };
}

async function handleGetAssetTags(
  req: IncomingMessage,
  res: ServerResponse,
  assetId: string
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const db = getDb();

    // Verify asset belongs to user
    const { data: asset, error: assetError } = await db
      .from('assets')
      .select('id')
      .eq('id', assetId)
      .eq('user_id', userId)
      .single();

    if (assetError || !asset) {
      sendJson(res, 404, { success: false, error: 'Asset not found' });
      return;
    }

    // Get tags for this asset
    const { data: assetTags, error } = await db
      .from('asset_tags')
      .select(`
        tag_id,
        tags (id, name, color, is_favorite)
      `)
      .eq('asset_id', assetId)
      .eq('user_id', userId);

    if (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    // Flatten the response
    const tags = assetTags?.map((at: any) => at.tags).filter(Boolean) || [];

    sendJson(res, 200, { success: true, data: tags });
  } catch (err) {
    console.error('Error getting asset tags:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleAddTags(
  req: IncomingMessage,
  res: ServerResponse,
  assetId: string
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = (await parseBody(req)) as AddTagsRequest;

    if (!body.tag_ids || !Array.isArray(body.tag_ids) || body.tag_ids.length === 0) {
      sendJson(res, 400, { success: false, error: 'tag_ids array is required' });
      return;
    }

    const db = getDb();

    // Verify asset belongs to user
    const { data: asset, error: assetError } = await db
      .from('assets')
      .select('id')
      .eq('id', assetId)
      .eq('user_id', userId)
      .single();

    if (assetError || !asset) {
      sendJson(res, 404, { success: false, error: 'Asset not found' });
      return;
    }

    // Verify all tags belong to user
    const { data: tags } = await db
      .from('tags')
      .select('id')
      .eq('user_id', userId)
      .in('id', body.tag_ids);

    const validTagIds = tags?.map((t: { id: string }) => t.id) || [];

    if (validTagIds.length === 0) {
      sendJson(res, 400, { success: false, error: 'No valid tag IDs provided' });
      return;
    }

    // Get existing tags to avoid duplicates
    const { data: existingTags } = await db
      .from('asset_tags')
      .select('tag_id')
      .eq('asset_id', assetId)
      .eq('user_id', userId);

    const existingTagIds = new Set(existingTags?.map((t: { tag_id: string }) => t.tag_id) || []);
    const newTagIds = validTagIds.filter((id: string) => !existingTagIds.has(id));

    if (newTagIds.length > 0) {
      const inserts = newTagIds.map((tag_id: string) => ({
        asset_id: assetId,
        tag_id,
        user_id: userId,
      }));

      const { error } = await db.from('asset_tags').insert(inserts);

      if (error) {
        sendJson(res, 500, { success: false, error: error.message });
        return;
      }
    }

    // Return updated tags
    const { data: updatedTags } = await db
      .from('asset_tags')
      .select(`
        tag_id,
        tags (id, name, color, is_favorite)
      `)
      .eq('asset_id', assetId)
      .eq('user_id', userId);

    const tagsList = updatedTags?.map((at: any) => at.tags).filter(Boolean) || [];

    sendJson(res, 200, { success: true, data: tagsList });
  } catch (err) {
    console.error('Error adding tags to asset:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleRemoveTag(
  req: IncomingMessage,
  res: ServerResponse,
  assetId: string,
  tagId: string
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const db = getDb();

    const { error } = await db
      .from('asset_tags')
      .delete()
      .eq('asset_id', assetId)
      .eq('tag_id', tagId)
      .eq('user_id', userId);

    if (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 200, { success: true, data: { message: 'Tag removed from asset' } });
  } catch (err) {
    console.error('Error removing tag from asset:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleAssetTags(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const { assetId, tagId } = extractIdsFromPath(pathname);

  if (!assetId) {
    sendJson(res, 400, { success: false, error: 'Asset ID required' });
    return;
  }

  // GET /api/assets/:id/tags - Get tags for asset
  if (req.method === 'GET' && !tagId) {
    return handleGetAssetTags(req, res, assetId);
  }

  // POST /api/assets/:id/tags - Add tags to asset
  if (req.method === 'POST' && !tagId) {
    return handleAddTags(req, res, assetId);
  }

  // DELETE /api/assets/:id/tags/:tagId - Remove tag from asset
  if (req.method === 'DELETE' && tagId) {
    return handleRemoveTag(req, res, assetId, tagId);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
