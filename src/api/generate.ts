/**
 * Content Generation API
 *
 * POST /api/generate/weekly - Generate weekly content batch (runs in background)
 * GET /api/generate/status - Check generation status
 *
 * Gathers recent extractions and generates:
 * - 1 newsletter
 * - 1 blog post
 * - 5-6 LinkedIn posts
 * - 5-6 Twitter posts
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import {
  generateNewsletter,
  generateBlogPost,
  generateLinkedInPosts,
  generateTwitterPosts,
} from '../services/generate';
import { Asset, AssetInsert, AssetInputInsert } from '../types';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function sendJson(res: ServerResponse, status: number, data: ApiResponse): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

interface ExtractionRow {
  id: string;
  source_material_id: string | null;
  document_id: string | null;
  summary: string | null;
  key_points: string[] | null;
  topics: string[] | null;
  model: string | null;
  created_at: string;
  source_materials: {
    title: string | null;
    type: string;
  } | null;
  documents: {
    title: string | null;
  } | null;
}

// Generation state
let isGenerating = false;
let lastGenerationResult: {
  completedAt: string;
  generated: number;
  errors: string[];
} | null = null;

async function runGeneration(daysBack: number): Promise<void> {
  const db = getDb();

  // Get extractions from the last N days with source material info
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const { data: extractions, error: fetchError } = await db
    .from('extractions')
    .select(`
      *,
      source_materials (title, type),
      documents (title)
    `)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false });

  if (fetchError) {
    throw new Error(`Failed to fetch extractions: ${fetchError.message}`);
  }

  if (!extractions || extractions.length === 0) {
    throw new Error(`No extractions found in the last ${daysBack} days`);
  }

  // Transform for generation
  const extractionsWithSource = (extractions as ExtractionRow[]).map((e) => ({
    ...e,
    source_title: e.source_materials?.title ?? e.documents?.title ?? undefined,
    source_type: e.source_materials?.type ?? (e.document_id ? 'article' : undefined),
  }));

  console.log(`[Generate] Creating content from ${extractions.length} extractions...`);

  const assets: Asset[] = [];
  const errors: string[] = [];

  // Track source material IDs and document IDs for provenance
  const sourceIds = extractions
    .map((e) => (e as ExtractionRow).source_material_id)
    .filter((id): id is string => id !== null);

  const documentIds = extractions
    .map((e) => (e as ExtractionRow).document_id)
    .filter((id): id is string => id !== null);

  // Generate newsletter
  try {
    console.log('[Generate] Creating newsletter...');
    const newsletter = await generateNewsletter(extractionsWithSource);
    const asset = await saveAsset(db, 'newsletter', newsletter.title, newsletter.content, sourceIds, documentIds);
    assets.push(asset);
  } catch (err) {
    errors.push(`Newsletter: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // Generate blog post
  try {
    console.log('[Generate] Creating blog post...');
    const blogPost = await generateBlogPost(extractionsWithSource);
    const asset = await saveAsset(db, 'blog_post', blogPost.title, blogPost.content, sourceIds, documentIds);
    assets.push(asset);
  } catch (err) {
    errors.push(`Blog post: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // Generate LinkedIn posts
  try {
    console.log('[Generate] Creating LinkedIn posts...');
    const linkedInPosts = await generateLinkedInPosts(extractionsWithSource);
    for (const post of linkedInPosts) {
      const asset = await saveAsset(db, 'linkedin_post', post.title, post.content, sourceIds, documentIds);
      assets.push(asset);
    }
  } catch (err) {
    errors.push(`LinkedIn posts: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // Generate Twitter posts
  try {
    console.log('[Generate] Creating Twitter posts...');
    const twitterPosts = await generateTwitterPosts(extractionsWithSource);
    for (const post of twitterPosts) {
      const asset = await saveAsset(db, 'twitter_post', post.title, post.content, sourceIds, documentIds);
      assets.push(asset);
    }
  } catch (err) {
    errors.push(`Twitter posts: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  console.log(`[Generate] Complete: ${assets.length} assets created`);

  lastGenerationResult = {
    completedAt: new Date().toISOString(),
    generated: assets.length,
    errors,
  };
}

async function handleWeekly(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (isGenerating) {
      sendJson(res, 409, { success: false, error: 'Generation already in progress' });
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const daysBack = parseInt(url.searchParams.get('days') ?? '7', 10);

    isGenerating = true;

    // Run in background - don't await
    runGeneration(daysBack)
      .catch((err) => {
        console.error('[Generate] Failed:', err);
        lastGenerationResult = {
          completedAt: new Date().toISOString(),
          generated: 0,
          errors: [err instanceof Error ? err.message : 'Unknown error'],
        };
      })
      .finally(() => {
        isGenerating = false;
      });

    sendJson(res, 202, {
      success: true,
      data: {
        message: 'Generation started in background',
        status: 'running',
        daysBack,
      },
    });
  } catch (err) {
    console.error('Error starting generation:', err);
    isGenerating = false;
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, {
    success: true,
    data: {
      isGenerating,
      lastResult: lastGenerationResult,
    },
  });
}

async function saveAsset(
  db: ReturnType<typeof getDb>,
  type: 'newsletter' | 'blog_post' | 'linkedin_post' | 'twitter_post',
  title: string,
  content: string,
  sourceIds: string[],
  documentIds: string[]
): Promise<Asset> {
  const insert: AssetInsert = {
    type,
    title,
    content,
    status: 'draft',
    publish_date: null,
    published_url: null,
  };

  const { data, error } = await db
    .from('assets')
    .insert(insert)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save ${type}: ${error.message}`);
  }

  const asset = data as Asset;

  // Create provenance links for source materials
  if (sourceIds.length > 0) {
    const smInputs: AssetInputInsert[] = sourceIds.map((smId) => ({
      asset_id: asset.id,
      source_material_id: smId,
      document_id: null,
      note: null,
    }));

    await db.from('asset_inputs').insert(smInputs);
  }

  // Create provenance links for documents
  if (documentIds.length > 0) {
    const docInputs: AssetInputInsert[] = documentIds.map((docId) => ({
      asset_id: asset.id,
      source_material_id: null,
      document_id: docId,
      note: null,
    }));

    await db.from('asset_inputs').insert(docInputs);
  }

  return asset;
}

export async function handleGenerate(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  if (pathname === '/api/generate/weekly' && req.method === 'POST') {
    return handleWeekly(req, res);
  }

  if (pathname === '/api/generate/status' && req.method === 'GET') {
    return handleStatus(req, res);
  }

  sendJson(res, 404, { success: false, error: 'Not found' });
}
