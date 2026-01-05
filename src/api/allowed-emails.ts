/**
 * Allowed Emails API (Admin Only)
 *
 * GET    /api/allowed-emails - List all allowed emails
 * POST   /api/allowed-emails - Add an email to the allowlist
 * DELETE /api/allowed-emails/:email - Remove an email from the allowlist
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId, isAdmin } from '../middleware/auth';

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

function extractEmailFromPath(pathname: string): string | null {
  const match = pathname.match(/\/api\/allowed-emails\/(.+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!isAdmin(req)) {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }

    const db = getDb();
    const { data, error } = await db
      .from('allowed_emails')
      .select('id, email, added_by, created_at')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to fetch allowed emails' });
      return;
    }

    sendJson(res, 200, { success: true, data });
  } catch (err) {
    console.error('Error listing allowed emails:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

async function handleAdd(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!isAdmin(req)) {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }

    const userId = requireUserId(req);
    const body = (await parseBody(req)) as Record<string, unknown>;

    if (!body.email || typeof body.email !== 'string') {
      sendJson(res, 400, { success: false, error: 'Email is required' });
      return;
    }

    const email = body.email.toLowerCase().trim();

    // Basic email validation
    if (!email.includes('@') || !email.includes('.')) {
      sendJson(res, 400, { success: false, error: 'Invalid email format' });
      return;
    }

    const db = getDb();
    const { data, error } = await db
      .from('allowed_emails')
      .insert({ email, added_by: userId })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        sendJson(res, 409, { success: false, error: 'Email already in allowlist' });
        return;
      }
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to add email' });
      return;
    }

    sendJson(res, 201, { success: true, data });
  } catch (err) {
    console.error('Error adding allowed email:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

async function handleDelete(
  req: IncomingMessage,
  res: ServerResponse,
  email: string
): Promise<void> {
  try {
    if (!isAdmin(req)) {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }

    const db = getDb();
    const { error } = await db
      .from('allowed_emails')
      .delete()
      .eq('email', email.toLowerCase());

    if (error) {
      console.error('Database error:', error);
      sendJson(res, 500, { success: false, error: 'Failed to remove email' });
      return;
    }

    sendJson(res, 200, { success: true, data: { message: 'Email removed from allowlist' } });
  } catch (err) {
    console.error('Error removing allowed email:', err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
  }
}

export async function handleAllowedEmails(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const email = extractEmailFromPath(pathname);

  // List all allowed emails
  if (pathname === '/api/allowed-emails' && req.method === 'GET') {
    return handleList(req, res);
  }

  // Add email to allowlist
  if (pathname === '/api/allowed-emails' && req.method === 'POST') {
    return handleAdd(req, res);
  }

  // Remove email from allowlist
  if (email && req.method === 'DELETE') {
    return handleDelete(req, res, email);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
