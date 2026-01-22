/**
 * Assets API
 *
 * GET    /api/assets          - List all assets (filter by type, status)
 * POST   /api/assets          - Create new asset (for adding existing content)
 * GET    /api/assets/:id      - Get single asset with inputs
 * PATCH  /api/assets/:id      - Update asset (status, title, content)
 * DELETE /api/assets/:id      - Delete asset
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
import { Asset, AssetType, AssetStatus } from '../types';
import { getClaudeClient } from '../services/claude';
import { getProfileContextForUser } from '../services/profile';

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
  const match = pathname.match(/\/api\/assets\/([^/]+)/);
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
    const type = params.get('type');
    const status = params.get('status');
    const tagId = params.get('tag_id');
    const includeTags = params.get('include_tags') === 'true';
    const limit = parseInt(params.get('limit') || '50', 10);
    const offset = parseInt(params.get('offset') || '0', 10);

    const db = getDb();

    // If filtering by tag, we need to get asset IDs first
    let assetIdsToFilter: string[] | null = null;
    if (tagId) {
      const { data: assetTags } = await db
        .from('asset_tags')
        .select('asset_id')
        .eq('tag_id', tagId)
        .eq('user_id', userId);

      assetIdsToFilter = assetTags?.map((at: { asset_id: string }) => at.asset_id) || [];

      if (assetIdsToFilter.length === 0) {
        // No assets with this tag
        sendJson(res, 200, {
          success: true,
          data: { assets: [], total: 0, limit, offset },
        });
        return;
      }
    }

    let query = db
      .from('assets')
      .select('id, type, title, status, publish_date, published_url, created_at, updated_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (type) {
      query = query.eq('type', type);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (assetIdsToFilter) {
      query = query.in('id', assetIdsToFilter);
    }

    const { data, error, count } = await query;

    if (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    // If include_tags requested, fetch tags for each asset
    let assetsWithTags = data;
    if (includeTags && data && data.length > 0) {
      const assetIds = data.map((a: { id: string }) => a.id);
      const { data: assetTags } = await db
        .from('asset_tags')
        .select(`
          asset_id,
          tags (id, name, color, is_favorite)
        `)
        .eq('user_id', userId)
        .in('asset_id', assetIds);

      // Group tags by asset_id
      const tagsMap: Record<string, any[]> = {};
      assetTags?.forEach((at: any) => {
        if (at.tags) {
          if (!tagsMap[at.asset_id]) {
            tagsMap[at.asset_id] = [];
          }
          tagsMap[at.asset_id].push(at.tags);
        }
      });

      assetsWithTags = data.map((asset: any) => ({
        ...asset,
        tags: tagsMap[asset.id] || [],
      }));
    }

    sendJson(res, 200, {
      success: true,
      data: {
        assets: assetsWithTags,
        total: count,
        limit,
        offset,
      },
    });
  } catch (err) {
    console.error('Error listing assets:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

interface CreateAssetRequest {
  type: AssetType;
  title: string;
  content: string;
  status?: AssetStatus;
  publish_date?: string | null;
  published_url?: string | null;
}

const VALID_ASSET_TYPES: AssetType[] = [
  'linkedin_post',
  'twitter_post',
  'blog_post',
  'newsletter',
  'video_script',
  'podcast_segment',
];

const VALID_STATUSES: AssetStatus[] = ['draft', 'ready', 'published', 'archived'];

async function handleCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = (await parseBody(req)) as CreateAssetRequest;

    // Validate required fields
    if (!body.type || !body.title || !body.content) {
      sendJson(res, 400, {
        success: false,
        error: 'Required fields: type, title, content',
      });
      return;
    }

    // Validate type
    if (!VALID_ASSET_TYPES.includes(body.type)) {
      sendJson(res, 400, {
        success: false,
        error: `Invalid type. Must be one of: ${VALID_ASSET_TYPES.join(', ')}`,
      });
      return;
    }

    // Validate status if provided
    const status = body.status || 'draft';
    if (!VALID_STATUSES.includes(status)) {
      sendJson(res, 400, {
        success: false,
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
      return;
    }

    const db = getDb();

    const insert = {
      user_id: userId,
      type: body.type,
      title: body.title,
      content: body.content,
      status,
      publish_date: body.publish_date || null,
      published_url: body.published_url || null,
    };

    const { data: asset, error } = await db
      .from('assets')
      .insert(insert)
      .select()
      .single();

    if (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    console.log(`[Assets] Created new asset: ${asset.id} (${body.type})`);

    sendJson(res, 201, { success: true, data: asset });
  } catch (err) {
    console.error('Error creating asset:', err);
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

    // Get asset with inputs (filter by user_id for security)
    const { data: asset, error } = await db
      .from('assets')
      .select(`
        *,
        asset_inputs (
          id,
          note,
          source_material_id,
          document_id,
          source_materials (id, title, type),
          documents (id, title, url)
        )
      `)
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        sendJson(res, 404, { success: false, error: 'Asset not found' });
        return;
      }
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 200, { success: true, data: asset });
  } catch (err) {
    console.error('Error fetching asset:', err);
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
    const body = (await parseBody(req)) as Record<string, unknown>;

    // Build update object with only allowed fields
    const allowedFields = ['status', 'title', 'content', 'publish_date', 'published_url'];
    const updates: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      sendJson(res, 400, {
        success: false,
        error: `No valid fields to update. Allowed: ${allowedFields.join(', ')}`,
      });
      return;
    }

    // Validate status if provided
    if (updates.status) {
      const validStatuses = ['draft', 'ready', 'published', 'archived'];
      if (!validStatuses.includes(updates.status as string)) {
        sendJson(res, 400, {
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        });
        return;
      }
    }

    const userId = requireUserId(req);
    const db = getDb();

    const { data, error } = await db
      .from('assets')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        sendJson(res, 404, { success: false, error: 'Asset not found' });
        return;
      }
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 200, { success: true, data });
  } catch (err) {
    console.error('Error updating asset:', err);
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

    // Check if asset exists and get its status
    const { data: asset, error: fetchError } = await db
      .from('assets')
      .select('id, status')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchError || !asset) {
      sendJson(res, 404, { success: false, error: 'Asset not found' });
      return;
    }

    // Prevent deleting published assets
    if (asset.status === 'published') {
      sendJson(res, 400, {
        success: false,
        error: 'Cannot delete published assets. Archive it first or change status to draft.',
      });
      return;
    }

    // Delete asset inputs first (foreign key constraint)
    await db.from('asset_inputs').delete().eq('asset_id', id).eq('user_id', userId);

    // Delete the asset
    const { error } = await db.from('assets').delete().eq('id', id).eq('user_id', userId);

    if (error) {
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 200, {
      success: true,
      data: { message: 'Asset deleted successfully' },
    });
  } catch (err) {
    console.error('Error deleting asset:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

// ============================================================================
// Content Improvement
// ============================================================================

interface ImproveAssetRequest {
  content: string;
  content_type: string;
  custom_prompt: string;
  title?: string;
}

function buildImprovementPrompt(
  content: string,
  contentType: string,
  customPrompt: string,
  title?: string
): string {
  const titleContext = title ? `\nTITLE: ${title}` : '';

  return `You are an expert content editor specializing in ${contentType} optimization.

Your task is to improve the following content based on the user's specific instructions.

INSTRUCTIONS FROM USER:
${customPrompt}
${titleContext}

ORIGINAL CONTENT:
${content}

RULES:
1. Apply ONLY the changes requested by the user
2. Maintain the author's voice and core message
3. Keep the content appropriate for the platform (${contentType})
4. For LinkedIn: Stay under 3,000 characters; preserve line breaks for readability
5. Return ONLY the improved content, no explanations or preamble`;
}

async function handleImprove(
  req: IncomingMessage,
  res: ServerResponse,
  id: string
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = (await parseBody(req)) as ImproveAssetRequest;

    // Validate custom_prompt is provided
    if (!body.custom_prompt || !body.custom_prompt.trim()) {
      sendJson(res, 400, {
        success: false,
        error: 'custom_prompt is required',
      });
      return;
    }

    const db = getDb();

    // Fetch the asset
    const { data: asset, error: assetError } = await db
      .from('assets')
      .select('id, type, title, content')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (assetError || !asset) {
      sendJson(res, 404, { success: false, error: 'Asset not found' });
      return;
    }

    // Use provided content or fall back to asset content
    const contentToImprove = body.content || asset.content;
    const contentType = body.content_type || asset.type;
    const title = body.title || asset.title;

    console.log(`[Improve] Starting improvement for asset ${id} (${contentType})`);

    // Get user profile context for maintaining voice
    const profileContext = await getProfileContextForUser(userId);

    // Build the full prompt
    const improvementPrompt = buildImprovementPrompt(
      contentToImprove,
      contentType,
      body.custom_prompt,
      title
    );

    let fullPrompt = '';
    if (profileContext) {
      fullPrompt = `${profileContext}\n${improvementPrompt}`;
      console.log('[Improve] Using content profile for voice consistency');
    } else {
      fullPrompt = improvementPrompt;
    }

    // Call Claude for improvement
    const claude = getClaudeClient();
    const response = await claude.messages.create({
      model: 'claude-opus-4-5-20250514',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: fullPrompt,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const improvedContent = textBlock.text.trim();

    console.log(`[Improve] Successfully improved asset ${id}`);

    sendJson(res, 200, {
      success: true,
      data: {
        improved_content: improvedContent,
        original_content: contentToImprove,
      },
    });
  } catch (err) {
    console.error('[Improve] Error:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

// ============================================================================
// Main Router
// ============================================================================

export async function handleAssets(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const id = extractIdFromPath(pathname);

  // Asset improvement endpoint (must come before other single-asset operations)
  if (pathname.match(/\/api\/assets\/[^/]+\/improve$/) && req.method === 'POST') {
    const improveId = pathname.match(/\/api\/assets\/([^/]+)\/improve$/)?.[1];
    if (improveId) {
      return handleImprove(req, res, improveId);
    }
  }

  // List all assets
  if (pathname === '/api/assets' && req.method === 'GET') {
    return handleList(req, res);
  }

  // Create new asset (for adding existing content)
  if (pathname === '/api/assets' && req.method === 'POST') {
    return handleCreate(req, res);
  }

  // Single asset operations
  if (id) {
    if (req.method === 'GET') {
      return handleGet(req, res, id);
    }
    if (req.method === 'PATCH') {
      return handleUpdate(req, res, id);
    }
    if (req.method === 'DELETE') {
      return handleDelete(req, res, id);
    }
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
