/**
 * Internal scheduler for background crawling and extraction
 *
 * Runs on cron schedule to avoid HTTP timeout issues
 */

import cron from 'node-cron';
import { createHash } from 'crypto';
import { getDb } from './db';
import { crawlBlog, scrapePage } from './firecrawl';
import { extractFromContent, EXTRACTION_MODEL } from './claude';
import { TrendSource, DocumentInsert, ExtractionInsert } from '../types';

// Configuration
const CRAWL_SCHEDULE = process.env.CRAWL_SCHEDULE || '0 */6 * * *'; // Every 6 hours
const SOURCES_PER_RUN = parseInt(process.env.SOURCES_PER_RUN || '3', 10);
const ARTICLES_PER_SOURCE = parseInt(process.env.ARTICLES_PER_SOURCE || '5', 10);
const EXTRACTIONS_PER_RUN = parseInt(process.env.EXTRACTIONS_PER_RUN || '10', 10);
const DELAY_BETWEEN_SOURCES_MS = 5000; // 5 seconds between sources

let isRunning = false;

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function crawlSources(): Promise<{ crawled: number; documents: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];
  let documentsCreated = 0;

  // Get active Tier 1 sources, prioritize those not recently crawled
  const { data: sources, error: sourcesError } = await db
    .from('trend_sources')
    .select('*')
    .eq('status', 'active')
    .eq('tier', 1)
    .order('updated_at', { ascending: true })
    .limit(SOURCES_PER_RUN);

  if (sourcesError || !sources || sources.length === 0) {
    console.log('[Scheduler] No sources to crawl');
    return { crawled: 0, documents: 0, errors: [] };
  }

  console.log(`[Scheduler] Crawling ${sources.length} sources...`);

  for (const source of sources as TrendSource[]) {
    try {
      const crawlUrl = source.feed_url || (source.domain ? `https://${source.domain}` : null);

      if (!crawlUrl) {
        errors.push(`${source.name}: No URL configured`);
        continue;
      }

      console.log(`[Scheduler] Crawling: ${source.name}`);

      const pages = await crawlBlog(crawlUrl, { limit: ARTICLES_PER_SOURCE });

      for (const page of pages) {
        // Check for duplicates
        const dedupeHash = hashContent(page.content);
        const { data: existing } = await db
          .from('documents')
          .select('id')
          .or(`url.eq.${page.url},dedupe_hash.eq.${dedupeHash}`)
          .limit(1);

        if (existing && existing.length > 0) {
          continue; // Skip duplicate
        }

        const insert: DocumentInsert = {
          trend_source_id: source.id,
          url: page.url,
          canonical_url: null,
          title: page.title,
          author: page.author,
          published_at: page.publishedAt,
          raw_text: page.content,
          dedupe_hash: dedupeHash,
          status: 'parsed',
        };

        const { error: insertError } = await db.from('documents').insert(insert);

        if (!insertError) {
          documentsCreated++;
        }
      }

      // Update source's updated_at to track when it was last crawled
      await db
        .from('trend_sources')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', source.id);

      console.log(`[Scheduler] ${source.name}: Found ${pages.length} pages`);

      // Delay between sources to be nice to APIs
      await sleep(DELAY_BETWEEN_SOURCES_MS);
    } catch (err) {
      const msg = `${source.name}: ${err instanceof Error ? err.message : 'Unknown error'}`;
      console.error(`[Scheduler] Error:`, msg);
      errors.push(msg);
    }
  }

  return { crawled: sources.length, documents: documentsCreated, errors };
}

async function runExtractions(): Promise<{ extracted: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];
  let extracted = 0;

  // Get documents without extractions
  const { data: existingExtractions } = await db
    .from('extractions')
    .select('document_id')
    .not('document_id', 'is', null);

  const existingDocIds = new Set(
    (existingExtractions ?? []).map((e: { document_id: string | null }) => e.document_id)
  );

  const { data: documents } = await db
    .from('documents')
    .select('id, title, raw_text')
    .eq('status', 'parsed')
    .not('raw_text', 'is', null)
    .order('created_at', { ascending: true })
    .limit(EXTRACTIONS_PER_RUN * 2); // Fetch more to filter

  if (!documents || documents.length === 0) {
    console.log('[Scheduler] No documents to extract');
    return { extracted: 0, errors: [] };
  }

  const toExtract = documents.filter(
    (doc: { id: string }) => !existingDocIds.has(doc.id)
  ).slice(0, EXTRACTIONS_PER_RUN);

  console.log(`[Scheduler] Extracting ${toExtract.length} documents...`);

  for (const doc of toExtract as { id: string; title: string | null; raw_text: string }[]) {
    try {
      console.log(`[Scheduler] Extracting: ${doc.title || doc.id}`);

      const result = await extractFromContent(doc.raw_text, 'document');

      const insert: ExtractionInsert = {
        source_material_id: null,
        document_id: doc.id,
        summary: result.summary,
        key_points: result.key_points,
        topics: result.topics,
        model: EXTRACTION_MODEL,
      };

      const { error: insertError } = await db.from('extractions').insert(insert);

      if (!insertError) {
        extracted++;
      } else {
        errors.push(`${doc.title || doc.id}: ${insertError.message}`);
      }
    } catch (err) {
      errors.push(`${doc.title || doc.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return { extracted, errors };
}

async function runScheduledJob(): Promise<void> {
  if (isRunning) {
    console.log('[Scheduler] Job already running, skipping...');
    return;
  }

  isRunning = true;
  console.log(`[Scheduler] Starting scheduled job at ${new Date().toISOString()}`);

  try {
    // Step 1: Crawl sources
    const crawlResult = await crawlSources();
    console.log(`[Scheduler] Crawl complete: ${crawlResult.documents} new documents from ${crawlResult.crawled} sources`);

    // Step 2: Run extractions
    const extractResult = await runExtractions();
    console.log(`[Scheduler] Extraction complete: ${extractResult.extracted} new extractions`);

    console.log(`[Scheduler] Job finished at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('[Scheduler] Job failed:', err);
  } finally {
    isRunning = false;
  }
}

export function startScheduler(): void {
  console.log(`[Scheduler] Starting with schedule: ${CRAWL_SCHEDULE}`);
  console.log(`[Scheduler] Config: ${SOURCES_PER_RUN} sources, ${ARTICLES_PER_SOURCE} articles each, ${EXTRACTIONS_PER_RUN} extractions per run`);

  // Validate cron expression
  if (!cron.validate(CRAWL_SCHEDULE)) {
    console.error(`[Scheduler] Invalid cron expression: ${CRAWL_SCHEDULE}`);
    return;
  }

  // Schedule the job
  cron.schedule(CRAWL_SCHEDULE, () => {
    runScheduledJob().catch(console.error);
  });

  console.log('[Scheduler] Scheduler started successfully');
}

// Manual trigger for testing
export async function triggerManualRun(): Promise<{
  crawl: { crawled: number; documents: number; errors: string[] };
  extraction: { extracted: number; errors: string[] };
}> {
  if (isRunning) {
    throw new Error('Job already running');
  }

  isRunning = true;

  try {
    const crawl = await crawlSources();
    const extraction = await runExtractions();
    return { crawl, extraction };
  } finally {
    isRunning = false;
  }
}

export function getSchedulerStatus(): { isRunning: boolean; schedule: string } {
  return { isRunning, schedule: CRAWL_SCHEDULE };
}
