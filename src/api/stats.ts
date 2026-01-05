/**
 * Stats API
 *
 * GET /api/stats - Dashboard overview with counts and recent activity
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function sendJson(res: ServerResponse, status: number, data: ApiResponse): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

interface DashboardStats {
  counts: {
    source_materials: number;
    documents: number;
    extractions: number;
    assets: {
      total: number;
      by_status: Record<string, number>;
      by_type: Record<string, number>;
    };
    trend_sources: number;
  };
  recent: {
    assets: Array<{
      id: string;
      type: string;
      title: string;
      status: string;
      created_at: string;
    }>;
    source_materials: Array<{
      id: string;
      title: string;
      type: string;
      created_at: string;
    }>;
    documents: Array<{
      id: string;
      title: string;
      url: string;
      crawled_at: string;
    }>;
  };
  activity: {
    extractions_this_week: number;
    assets_this_week: number;
    documents_this_week: number;
  };
  settings: {
    crawl_schedule: string;
    generation_schedule: string;
    content_formats: string[];
    last_crawl_at: string | null;
    last_generation_at: string | null;
  } | null;
}

export async function handleStats(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return;
  }

  try {
    const userId = requireUserId(req);
    const db = getDb();
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Run all queries in parallel (all filtered by user_id)
    const [
      sourceMaterialsCount,
      documentsCount,
      extractionsCount,
      assetsData,
      trendSourcesCount,
      recentAssets,
      recentSourceMaterials,
      recentDocuments,
      extractionsThisWeek,
      assetsThisWeek,
      documentsThisWeek,
      userSettings,
    ] = await Promise.all([
      // Counts
      db.from('source_materials').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      db.from('documents').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      db.from('extractions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      db.from('assets').select('id, status, type').eq('user_id', userId),
      db.from('trend_sources').select('id', { count: 'exact', head: true }).eq('user_id', userId),

      // Recent items
      db
        .from('assets')
        .select('id, type, title, status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),
      db
        .from('source_materials')
        .select('id, title, type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),
      db
        .from('documents')
        .select('id, title, url, crawled_at')
        .eq('user_id', userId)
        .order('crawled_at', { ascending: false })
        .limit(5),

      // This week activity
      db
        .from('extractions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('extracted_at', oneWeekAgo),
      db
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', oneWeekAgo),
      db
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('crawled_at', oneWeekAgo),

      // User settings
      db
        .from('user_settings')
        .select('crawl_schedule, generation_schedule, content_formats, last_crawl_at, last_generation_at')
        .eq('user_id', userId)
        .single(),
    ]);

    // Calculate asset breakdowns
    const assetsByStatus: Record<string, number> = {};
    const assetsByType: Record<string, number> = {};

    if (assetsData.data) {
      for (const asset of assetsData.data) {
        assetsByStatus[asset.status] = (assetsByStatus[asset.status] || 0) + 1;
        assetsByType[asset.type] = (assetsByType[asset.type] || 0) + 1;
      }
    }

    const stats: DashboardStats = {
      counts: {
        source_materials: sourceMaterialsCount.count || 0,
        documents: documentsCount.count || 0,
        extractions: extractionsCount.count || 0,
        assets: {
          total: assetsData.data?.length || 0,
          by_status: assetsByStatus,
          by_type: assetsByType,
        },
        trend_sources: trendSourcesCount.count || 0,
      },
      recent: {
        assets: recentAssets.data || [],
        source_materials: recentSourceMaterials.data || [],
        documents: recentDocuments.data || [],
      },
      activity: {
        extractions_this_week: extractionsThisWeek.count || 0,
        assets_this_week: assetsThisWeek.count || 0,
        documents_this_week: documentsThisWeek.count || 0,
      },
      settings: userSettings.data || null,
    };

    sendJson(res, 200, { success: true, data: stats });
  } catch (err) {
    console.error('Error fetching stats:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
