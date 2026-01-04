/**
 * Source Materials API
 *
 * POST /api/source-materials - Create a new source material
 * GET /api/source-materials - List source materials (with optional filters)
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { SourceMaterial, SourceMaterialInsert, SourceMaterialType } from '../types';

interface CreateSourceMaterialRequest {
  type: SourceMaterialType;
  title?: string;
  content: string;
  source_url?: string;
  occurred_at?: string;
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

function validateCreateRequest(body: unknown): body is CreateSourceMaterialRequest {
  if (typeof body !== 'object' || body === null) return false;

  const obj = body as Record<string, unknown>;

  const validTypes: SourceMaterialType[] = ['trend', 'meeting', 'voice_note', 'manual_note'];
  if (!validTypes.includes(obj.type as SourceMaterialType)) return false;

  if (typeof obj.content !== 'string' || obj.content.trim() === '') return false;

  if (obj.title !== undefined && typeof obj.title !== 'string') return false;
  if (obj.source_url !== undefined && typeof obj.source_url !== 'string') return false;
  if (obj.occurred_at !== undefined && typeof obj.occurred_at !== 'string') return false;

  return true;
}

async function handleCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await parseBody(req);

    if (!validateCreateRequest(body)) {
      sendJson(res, 400, {
        success: false,
        error: 'Invalid request. Required: type (trend|meeting|voice_note|manual_note), content (non-empty string)',
      });
      return;
    }

    const insert: SourceMaterialInsert = {
      type: body.type,
      title: body.title ?? null,
      content: body.content.trim(),
      source_url: body.source_url ?? null,
      occurred_at: body.occurred_at ?? null,
    };

    const db = getDb();
    const { data, error } = await db
      .from('source_materials')
      .insert(insert)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to create source material' });
      return;
    }

    sendJson(res, 201, { success: true, data: data as SourceMaterial });
  } catch (err) {
    console.error('Error creating source material:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

async function handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const typeFilter = url.searchParams.get('type') as SourceMaterialType | null;
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

    const db = getDb();
    let query = db
      .from('source_materials')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (typeFilter) {
      query = query.eq('type', typeFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to fetch source materials' });
      return;
    }

    sendJson(res, 200, { success: true, data: data as SourceMaterial[] });
  } catch (err) {
    console.error('Error listing source materials:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

export async function handleSourceMaterials(
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
