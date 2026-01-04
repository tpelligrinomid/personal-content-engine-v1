/**
 * Digest API
 *
 * GET /api/digest - Get recent extractions for daily review
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function sendJson(res: ServerResponse, status: number, data: ApiResponse): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

interface DigestItem {
  id: string;
  source: 'document' | 'source_material';
  title: string | null;
  type: string | null;
  url: string | null;
  summary: string | null;
  key_points: string[] | null;
  topics: string[] | null;
  created_at: string;
}

interface DigestGroup {
  label: string;
  count: number;
  items: DigestItem[];
}

async function handleDigest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const days = parseInt(url.searchParams.get('days') ?? '1', 10);
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

    const db = getDb();

    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get recent extractions with source info
    const { data: extractions, error } = await db
      .from('extractions')
      .select(`
        id,
        summary,
        key_points,
        topics,
        created_at,
        source_material_id,
        document_id,
        source_materials (title, type),
        documents (title, url)
      `)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch extractions:', error);
      sendJson(res, 500, { success: false, error: 'Failed to fetch digest' });
      return;
    }

    if (!extractions || extractions.length === 0) {
      sendJson(res, 200, {
        success: true,
        data: {
          period: `Last ${days} day(s)`,
          total: 0,
          groups: [],
          message: 'No new content in this period',
        },
      });
      return;
    }

    // Transform and group
    const documentItems: DigestItem[] = [];
    const meetingItems: DigestItem[] = [];
    const voiceNoteItems: DigestItem[] = [];
    const trendItems: DigestItem[] = [];
    const noteItems: DigestItem[] = [];

    for (const e of extractions as any[]) {
      const isDocument = !!e.document_id;
      const sm = e.source_materials;
      const doc = e.documents;

      const item: DigestItem = {
        id: e.id,
        source: isDocument ? 'document' : 'source_material',
        title: isDocument ? doc?.title : sm?.title,
        type: isDocument ? 'article' : sm?.type,
        url: isDocument ? doc?.url : null,
        summary: e.summary,
        key_points: e.key_points,
        topics: e.topics,
        created_at: e.created_at,
      };

      if (isDocument) {
        documentItems.push(item);
      } else {
        const smType = sm?.type;
        if (smType === 'meeting') meetingItems.push(item);
        else if (smType === 'voice_note') voiceNoteItems.push(item);
        else if (smType === 'trend') trendItems.push(item);
        else if (smType === 'manual_note') noteItems.push(item);
      }
    }

    const groups: DigestGroup[] = [];

    if (documentItems.length > 0) {
      groups.push({ label: 'Articles', count: documentItems.length, items: documentItems });
    }
    if (meetingItems.length > 0) {
      groups.push({ label: 'Meetings', count: meetingItems.length, items: meetingItems });
    }
    if (voiceNoteItems.length > 0) {
      groups.push({ label: 'Voice Notes', count: voiceNoteItems.length, items: voiceNoteItems });
    }
    if (trendItems.length > 0) {
      groups.push({ label: 'Trends', count: trendItems.length, items: trendItems });
    }
    if (noteItems.length > 0) {
      groups.push({ label: 'Notes', count: noteItems.length, items: noteItems });
    }

    sendJson(res, 200, {
      success: true,
      data: {
        period: `Last ${days} day(s)`,
        total: extractions.length,
        groups,
      },
    });
  } catch (err) {
    console.error('Error fetching digest:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleDigestRoute(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'GET') {
    return handleDigest(req, res);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
