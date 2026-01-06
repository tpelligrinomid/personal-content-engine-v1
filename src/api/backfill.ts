/**
 * Backfill API
 *
 * POST /api/backfill/extractions - Backfill extractions for source materials without them
 *
 * Admin only. Safe to run multiple times - checks for existing extractions first.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireAdmin } from '../middleware/auth';
import { extractFromContent, EXTRACTION_MODEL } from '../services/claude';
import { SourceMaterial, ExtractionInsert } from '../types';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function sendJson(res: ServerResponse, status: number, data: ApiResponse): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleBackfillExtractions(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    requireAdmin(req);

    const db = getDb();

    console.log('[Backfill] Starting extraction backfill...');

    // Get all source materials
    const { data: allSourceMaterials, error: smError } = await db
      .from('source_materials')
      .select('id, user_id, type, title, content')
      .is('archived_at', null)
      .order('created_at', { ascending: true });

    if (smError || !allSourceMaterials) {
      sendJson(res, 500, { success: false, error: 'Failed to fetch source materials' });
      return;
    }

    // Get all existing extractions for source materials
    const { data: existingExtractions } = await db
      .from('extractions')
      .select('source_material_id')
      .not('source_material_id', 'is', null);

    const existingIds = new Set(
      (existingExtractions || []).map((e: { source_material_id: string }) => e.source_material_id)
    );

    // Filter to only those without extractions
    const needsExtraction = (allSourceMaterials as SourceMaterial[]).filter(
      (sm) => !existingIds.has(sm.id)
    );

    console.log(`[Backfill] ${needsExtraction.length} source materials need extraction`);

    if (needsExtraction.length === 0) {
      sendJson(res, 200, {
        success: true,
        data: {
          message: 'Nothing to backfill - all source materials have extractions',
          total: allSourceMaterials.length,
          existing: existingIds.size,
          backfilled: 0,
        },
      });
      return;
    }

    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const sm of needsExtraction) {
      try {
        console.log(`[Backfill] Extracting: ${sm.title} (${sm.type})`);

        const contentType = sm.type as 'meeting' | 'voice_note' | 'manual_note' | 'podcast' | 'trend';
        const extractionResult = await extractFromContent(sm.content, contentType);

        const extractionInsert: ExtractionInsert = {
          user_id: sm.user_id,
          source_material_id: sm.id,
          document_id: null,
          summary: extractionResult.summary,
          key_points: extractionResult.key_points,
          topics: extractionResult.topics,
          model: EXTRACTION_MODEL,
        };

        const { error: insertError } = await db
          .from('extractions')
          .insert(extractionInsert);

        if (insertError) {
          console.error(`[Backfill] Failed to save: ${sm.title}`, insertError);
          errors.push(`${sm.title}: ${insertError.message}`);
          failed++;
        } else {
          console.log(`[Backfill] ✓ Extracted: ${sm.title}`);
          success++;
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (err) {
        const msg = `${sm.title}: ${err instanceof Error ? err.message : 'Unknown error'}`;
        console.error(`[Backfill] Error:`, msg);
        errors.push(msg);
        failed++;
      }
    }

    console.log(`[Backfill] Complete! Success: ${success}, Failed: ${failed}`);

    sendJson(res, 200, {
      success: true,
      data: {
        message: 'Backfill complete',
        total: allSourceMaterials.length,
        existing: existingIds.size,
        needed: needsExtraction.length,
        backfilled: success,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (err) {
    console.error('[Backfill] Error:', err);
    if (err instanceof Error && err.message === 'Admin access required') {
      sendJson(res, 403, { success: false, error: 'Admin access required' });
      return;
    }
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleBackfill(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  if (pathname === '/api/backfill/extractions' && req.method === 'POST') {
    return handleBackfillExtractions(req, res);
  }

  sendJson(res, 404, { success: false, error: 'Not found' });
}
