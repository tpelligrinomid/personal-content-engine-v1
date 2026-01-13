/**
 * Ideas API
 *
 * POST /api/ideas/spark - Generate a single random idea
 * POST /api/ideas/batch - Generate multiple ideas (default 5)
 */

import { IncomingMessage, ServerResponse } from 'http';
import { requireUserId } from '../middleware/auth';
import { sparkIdea, sparkBatch } from '../services/ideas';

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

async function handleSpark(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);

    console.log(`[Ideas API] Spark request from user ${userId}`);

    const idea = await sparkIdea(userId);

    sendJson(res, 200, {
      success: true,
      data: idea,
    });
  } catch (err) {
    console.error('[Ideas API] Error generating idea:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate idea',
    });
  }
}

async function handleBatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = (await parseBody(req)) as { count?: number };

    const count = Math.min(Math.max(body.count || 5, 1), 10); // 1-10 ideas

    console.log(`[Ideas API] Batch request from user ${userId} for ${count} ideas`);

    const ideas = await sparkBatch(userId, count);

    sendJson(res, 200, {
      success: true,
      data: {
        ideas,
        count: ideas.length,
      },
    });
  } catch (err) {
    console.error('[Ideas API] Error generating batch:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate ideas',
    });
  }
}

export async function handleIdeas(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  if (pathname === '/api/ideas/spark' && req.method === 'POST') {
    return handleSpark(req, res);
  }

  if (pathname === '/api/ideas/batch' && req.method === 'POST') {
    return handleBatch(req, res);
  }

  sendJson(res, 404, { success: false, error: 'Not found' });
}
