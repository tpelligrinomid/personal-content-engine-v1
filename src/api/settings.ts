/**
 * User Settings API
 *
 * GET  /api/settings - Get current user's settings
 * PATCH /api/settings - Update current user's settings
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
import { UserSettings, UserSettingsUpdate } from '../types';

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

async function handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);
    const db = getDb();

    const { data: settings, error } = await db
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      // If no settings exist, return defaults
      if (error.code === 'PGRST116') {
        sendJson(res, 200, {
          success: true,
          data: {
            user_id: userId,
            role: 'user',
            crawl_enabled: true,
            crawl_schedule: 'daily',
            generation_enabled: true,
            generation_schedule: 'weekly_sunday',
            generation_time: '08:00',
            content_formats: ['linkedin_post'],
            timezone: 'America/New_York',
            last_crawl_at: null,
            last_generation_at: null,
          },
        });
        return;
      }
      sendJson(res, 500, { success: false, error: error.message });
      return;
    }

    sendJson(res, 200, { success: true, data: settings });
  } catch (err) {
    console.error('Error fetching settings:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleUpdate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = (await parseBody(req)) as Record<string, unknown>;
    const db = getDb();

    // Build update object with only allowed fields
    const allowedFields: (keyof UserSettingsUpdate)[] = [
      'crawl_enabled',
      'crawl_schedule',
      'generation_enabled',
      'generation_schedule',
      'generation_time',
      'content_formats',
      'timezone',
    ];

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

    // Validate content_formats if provided
    if (updates.content_formats) {
      const validFormats = ['linkedin_post', 'linkedin_pov', 'twitter_post', 'twitter_thread', 'blog_post', 'newsletter'];
      const formats = updates.content_formats as string[];
      const invalid = formats.filter((f) => !validFormats.includes(f));
      if (invalid.length > 0) {
        sendJson(res, 400, {
          success: false,
          error: `Invalid content formats: ${invalid.join(', ')}. Valid: ${validFormats.join(', ')}`,
        });
        return;
      }
    }

    // Validate schedules if provided
    if (updates.crawl_schedule) {
      const validCrawl = ['manual', 'every_6_hours', 'twice_daily', 'daily'];
      if (!validCrawl.includes(updates.crawl_schedule as string)) {
        sendJson(res, 400, {
          success: false,
          error: `Invalid crawl_schedule. Valid: ${validCrawl.join(', ')}`,
        });
        return;
      }
    }

    if (updates.generation_schedule) {
      const validGen = ['manual', 'daily', 'weekly_sunday', 'weekly_monday'];
      if (!validGen.includes(updates.generation_schedule as string)) {
        sendJson(res, 400, {
          success: false,
          error: `Invalid generation_schedule. Valid: ${validGen.join(', ')}`,
        });
        return;
      }
    }

    // Upsert settings
    const { data: existing } = await db
      .from('user_settings')
      .select('id')
      .eq('user_id', userId)
      .single();

    let result;

    if (existing) {
      const { data, error } = await db
        .from('user_settings')
        .update(updates)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        sendJson(res, 500, { success: false, error: error.message });
        return;
      }
      result = data;
    } else {
      // Create new settings
      const { data, error } = await db
        .from('user_settings')
        .insert({ user_id: userId, ...updates })
        .select()
        .single();

      if (error) {
        sendJson(res, 500, { success: false, error: error.message });
        return;
      }
      result = data;
    }

    sendJson(res, 200, { success: true, data: result });
  } catch (err) {
    console.error('Error updating settings:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleSettings(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  if (req.method === 'PATCH') {
    return handleUpdate(req, res);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
