/**
 * Crawl API
 *
 * POST /api/crawl/sources - Crawl all active sources (or filter by tier)
 * POST /api/crawl/url - Crawl a single URL
 */

import { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';
import { getDb } from '../services/db';
import { crawlBlog, scrapePage, ScrapedPage } from '../services/firecrawl';
import { TrendSource, Document, DocumentInsert } from '../types';

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

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function saveDocument(
  db: ReturnType<typeof getDb>,
  page: ScrapedPage,
  sourceId: string | null
): Promise<Document | null> {
  // Check for duplicate by URL or content hash
  const dedupeHash = hashContent(page.content);

  const { data: existing } = await db
    .from('documents')
    .select('id')
    .or(`url.eq.${page.url},dedupe_hash.eq.${dedupeHash}`)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`Skipping duplicate: ${page.url}`);
    return null;
  }

  const insert: DocumentInsert = {
    trend_source_id: sourceId,
    url: page.url,
    canonical_url: null,
    title: page.title,
    author: page.author,
    published_at: page.publishedAt,
    raw_text: page.content,
    dedupe_hash: dedupeHash,
    status: 'parsed',
  };

  const { data, error } = await db
    .from('documents')
    .insert(insert)
    .select()
    .single();

  if (error) {
    console.error(`Failed to save document ${page.url}:`, error);
    return null;
  }

  return data as Document;
}

async function handleCrawlSources(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const tier = url.searchParams.get('tier');
    const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);

    const db = getDb();

    // Get active sources
    let query = db
      .from('trend_sources')
      .select('*')
      .eq('status', 'active')
      .order('tier', { ascending: true });

    if (tier) {
      query = query.eq('tier', parseInt(tier, 10));
    }

    const { data: sources, error: sourcesError } = await query;

    if (sourcesError) {
      sendJson(res, 500, { success: false, error: 'Failed to fetch sources' });
      return;
    }

    if (!sources || sources.length === 0) {
      sendJson(res, 200, {
        success: true,
        data: { message: 'No active sources found', crawled: 0, documents: [] },
      });
      return;
    }

    console.log(`Crawling ${sources.length} sources...`);

    const allDocuments: Document[] = [];
    const errors: string[] = [];

    for (const source of sources as TrendSource[]) {
      try {
        // Determine URL to crawl
        const crawlUrl = source.feed_url || (source.domain ? `https://${source.domain}` : null);

        if (!crawlUrl) {
          errors.push(`${source.name}: No URL configured`);
          continue;
        }

        console.log(`Crawling source: ${source.name} (${crawlUrl})`);

        const pages = await crawlBlog(crawlUrl, { limit });

        for (const page of pages) {
          const doc = await saveDocument(db, page, source.id);
          if (doc) {
            allDocuments.push(doc);
          }
        }

        console.log(`${source.name}: Found ${pages.length} pages, saved ${allDocuments.length} new`);
      } catch (err) {
        const msg = `${source.name}: ${err instanceof Error ? err.message : 'Unknown error'}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    sendJson(res, 200, {
      success: true,
      data: {
        sources_crawled: sources.length,
        documents_saved: allDocuments.length,
        errors: errors.length > 0 ? errors : undefined,
        documents: allDocuments,
      },
    });
  } catch (err) {
    console.error('Error crawling sources:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

async function handleCrawlUrl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = (await parseBody(req)) as Record<string, unknown>;

    if (!body.url || typeof body.url !== 'string') {
      sendJson(res, 400, { success: false, error: 'url is required' });
      return;
    }

    const db = getDb();

    console.log(`Scraping single URL: ${body.url}`);
    const page = await scrapePage(body.url);

    const doc = await saveDocument(db, page, null);

    if (!doc) {
      sendJson(res, 200, {
        success: true,
        data: { message: 'Document already exists', duplicate: true },
      });
      return;
    }

    sendJson(res, 201, { success: true, data: doc });
  } catch (err) {
    console.error('Error crawling URL:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleCrawl(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  if (pathname === '/api/crawl/sources' && req.method === 'POST') {
    return handleCrawlSources(req, res);
  }

  if (pathname === '/api/crawl/url' && req.method === 'POST') {
    return handleCrawlUrl(req, res);
  }

  sendJson(res, 404, { success: false, error: 'Not found' });
}
