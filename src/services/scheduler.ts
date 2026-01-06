/**
 * Internal scheduler for background crawling and extraction
 *
 * Runs on cron schedule to avoid HTTP timeout issues
 * Now user-aware: processes each user's sources based on their settings
 */

import cron from 'node-cron';
import { createHash } from 'crypto';
import { getDb } from './db';
import { crawlBlog, scrapePage } from './firecrawl';
import { isRedditUrl, fetchFromRedditUrl } from './reddit';
import { isTwitterUrl, fetchFromTwitterSource, formatTweetAsContent } from './twitter';
import { extractFromContent, EXTRACTION_MODEL } from './claude';
import { TrendSource, DocumentInsert, ExtractionInsert, UserSettings } from '../types';

// Configuration
// Global schedule - how often the scheduler checks for work (not per-user schedule)
const SCHEDULER_CHECK_INTERVAL = process.env.SCHEDULER_CHECK_INTERVAL || '0 */1 * * *'; // Check every hour
const SOURCES_PER_RUN = parseInt(process.env.SOURCES_PER_RUN || '3', 10);
const ARTICLES_PER_SOURCE = parseInt(process.env.ARTICLES_PER_SOURCE || '5', 10);
const EXTRACTIONS_PER_RUN = parseInt(process.env.EXTRACTIONS_PER_RUN || '10', 10);
const DELAY_BETWEEN_SOURCES_MS = 5000; // 5 seconds between sources

/**
 * Check if a user should be crawled based on their schedule and last crawl time
 */
function shouldCrawlUser(
  schedule: string | null,
  lastCrawlAt: string | null,
  timezone: string | null
): boolean {
  if (!schedule) return false;

  const now = new Date();
  const userTz = timezone || 'UTC';

  // If never crawled, should crawl
  if (!lastCrawlAt) return true;

  const lastCrawl = new Date(lastCrawlAt);
  const hoursSinceLastCrawl = (now.getTime() - lastCrawl.getTime()) / (1000 * 60 * 60);

  // Parse schedule and determine if enough time has passed
  switch (schedule) {
    case 'hourly':
      return hoursSinceLastCrawl >= 1;

    case 'every_6_hours':
      return hoursSinceLastCrawl >= 6;

    case 'every_12_hours':
      return hoursSinceLastCrawl >= 12;

    case 'daily':
      return hoursSinceLastCrawl >= 24;

    case 'weekly':
    case 'weekly_sunday':
    case 'weekly_monday':
    case 'weekly_tuesday':
    case 'weekly_wednesday':
    case 'weekly_thursday':
    case 'weekly_friday':
    case 'weekly_saturday':
      return hoursSinceLastCrawl >= 24 * 7;

    default:
      // Unknown schedule, default to daily
      console.log(`[Scheduler] Unknown schedule "${schedule}", defaulting to daily`);
      return hoursSinceLastCrawl >= 24;
  }
}

let isRunning = false;
let lastRunAt: string | null = null;
let lastRunResult: {
  crawl: { crawled: number; documents: number; errors: string[] };
  extraction: { extracted: number; errors: string[] };
} | null = null;

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function crawlSourcesForUser(userId: string): Promise<{ crawled: number; documents: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];
  let documentsCreated = 0;

  // Get active Tier 1 sources for this user, prioritize those not recently crawled
  const { data: sources, error: sourcesError } = await db
    .from('trend_sources')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('tier', 1)
    .order('updated_at', { ascending: true })
    .limit(SOURCES_PER_RUN);

  if (sourcesError || !sources || sources.length === 0) {
    return { crawled: 0, documents: 0, errors: [] };
  }

  console.log(`[Scheduler] Crawling ${sources.length} sources for user ${userId}...`);

  for (const source of sources as TrendSource[]) {
    try {
      const crawlUrl = source.feed_url || (source.domain ? `https://${source.domain}` : null);

      if (!crawlUrl) {
        errors.push(`${source.name}: No URL configured`);
        continue;
      }

      console.log(`[Scheduler] Crawling: ${source.name}`);

      // Detect source type and use appropriate crawler
      let pages: Array<{
        url: string;
        title: string | null;
        content: string;
        author: string | null;
        publishedAt: string | null;
      }>;

      if (isTwitterUrl(crawlUrl)) {
        // Use Twitter/Apify crawler
        console.log(`[Scheduler] Detected Twitter source: ${crawlUrl}`);
        const tweets = await fetchFromTwitterSource(crawlUrl, {
          maxTweets: ARTICLES_PER_SOURCE,
          minLikes: 5, // Only get tweets with at least 5 likes
        });
        pages = tweets.map((tweet) => ({
          url: tweet.url,
          title: `Tweet by @${tweet.authorHandle}`,
          content: formatTweetAsContent(tweet),
          author: tweet.author,
          publishedAt: tweet.publishedAt,
        }));
      } else if (isRedditUrl(crawlUrl)) {
        // Use Reddit crawler
        console.log(`[Scheduler] Detected Reddit source: ${crawlUrl}`);
        const redditPosts = await fetchFromRedditUrl(crawlUrl, {
          limit: ARTICLES_PER_SOURCE,
          minScore: 5, // Only get posts with at least 5 upvotes
        });
        pages = redditPosts.map((post) => ({
          url: post.url,
          title: post.title,
          content: post.content,
          author: post.author,
          publishedAt: post.publishedAt,
        }));
      } else {
        // Use Firecrawl for regular websites
        pages = await crawlBlog(crawlUrl, { limit: ARTICLES_PER_SOURCE });
      }

      for (const page of pages) {
        // Check for duplicates for this user
        const dedupeHash = hashContent(page.content);
        const { data: existing } = await db
          .from('documents')
          .select('id')
          .eq('user_id', userId)
          .or(`url.eq.${page.url},dedupe_hash.eq.${dedupeHash}`)
          .limit(1);

        if (existing && existing.length > 0) {
          continue; // Skip duplicate
        }

        const insert: DocumentInsert = {
          user_id: userId,
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

interface UserSettingsForCrawl {
  user_id: string;
  crawl_schedule: string | null;
  last_crawl_at: string | null;
  timezone: string | null;
}

async function crawlSources(options: { force?: boolean } = {}): Promise<{ crawled: number; documents: number; errors: string[] }> {
  const { force = false } = options;
  const db = getDb();
  const allErrors: string[] = [];
  let totalCrawled = 0;
  let totalDocuments = 0;

  // Get all users with crawl_enabled, including their schedule settings
  const { data: usersSettings } = await db
    .from('user_settings')
    .select('user_id, crawl_schedule, last_crawl_at, timezone')
    .eq('crawl_enabled', true);

  if (!usersSettings || usersSettings.length === 0) {
    console.log('[Scheduler] No users with crawl enabled');
    return { crawled: 0, documents: 0, errors: [] };
  }

  for (const settings of usersSettings as UserSettingsForCrawl[]) {
    // Check if this user should be crawled based on their schedule (skip check if force=true)
    if (!force && !shouldCrawlUser(settings.crawl_schedule, settings.last_crawl_at, settings.timezone)) {
      console.log(`[Scheduler] Skipping user ${settings.user_id} - not due for crawl (schedule: ${settings.crawl_schedule}, last: ${settings.last_crawl_at})`);
      continue;
    }

    console.log(`[Scheduler] User ${settings.user_id} is due for crawl (schedule: ${settings.crawl_schedule})${force ? ' [FORCED]' : ''}`);

    const result = await crawlSourcesForUser(settings.user_id);
    totalCrawled += result.crawled;
    totalDocuments += result.documents;
    allErrors.push(...result.errors);

    // Update last_crawl_at for this user (even if no new documents, mark as crawled)
    await db
      .from('user_settings')
      .update({ last_crawl_at: new Date().toISOString() })
      .eq('user_id', settings.user_id);
  }

  return { crawled: totalCrawled, documents: totalDocuments, errors: allErrors };
}

async function runExtractionsForUser(userId: string): Promise<{ extracted: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];
  let extracted = 0;

  // Get documents without extractions for this user
  const { data: existingExtractions } = await db
    .from('extractions')
    .select('document_id')
    .eq('user_id', userId)
    .not('document_id', 'is', null);

  const existingDocIds = new Set(
    (existingExtractions ?? []).map((e: { document_id: string | null }) => e.document_id)
  );

  const { data: documents } = await db
    .from('documents')
    .select('id, title, raw_text')
    .eq('user_id', userId)
    .eq('status', 'parsed')
    .not('raw_text', 'is', null)
    .order('created_at', { ascending: true })
    .limit(EXTRACTIONS_PER_RUN * 2); // Fetch more to filter

  if (!documents || documents.length === 0) {
    return { extracted: 0, errors: [] };
  }

  const toExtract = documents.filter(
    (doc: { id: string }) => !existingDocIds.has(doc.id)
  ).slice(0, EXTRACTIONS_PER_RUN);

  console.log(`[Scheduler] Extracting ${toExtract.length} documents for user ${userId}...`);

  for (const doc of toExtract as { id: string; title: string | null; raw_text: string }[]) {
    try {
      console.log(`[Scheduler] Extracting: ${doc.title || doc.id}`);

      const result = await extractFromContent(doc.raw_text, 'document');

      const insert: ExtractionInsert = {
        user_id: userId,
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

async function runExtractions(): Promise<{ extracted: number; errors: string[] }> {
  const db = getDb();
  const allErrors: string[] = [];
  let totalExtracted = 0;

  // Get all users with crawl_enabled (extraction follows crawl)
  const { data: usersSettings } = await db
    .from('user_settings')
    .select('user_id')
    .eq('crawl_enabled', true);

  if (!usersSettings || usersSettings.length === 0) {
    console.log('[Scheduler] No users with crawl enabled');
    return { extracted: 0, errors: [] };
  }

  for (const settings of usersSettings as { user_id: string }[]) {
    const result = await runExtractionsForUser(settings.user_id);
    totalExtracted += result.extracted;
    allErrors.push(...result.errors);
  }

  return { extracted: totalExtracted, errors: allErrors };
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

    // Track results
    lastRunAt = new Date().toISOString();
    lastRunResult = { crawl: crawlResult, extraction: extractResult };

    console.log(`[Scheduler] Job finished at ${lastRunAt}`);
  } catch (err) {
    console.error('[Scheduler] Job failed:', err);
  } finally {
    isRunning = false;
  }
}

export function startScheduler(): void {
  console.log(`[Scheduler] Starting with check interval: ${SCHEDULER_CHECK_INTERVAL}`);
  console.log(`[Scheduler] Config: ${SOURCES_PER_RUN} sources, ${ARTICLES_PER_SOURCE} articles each, ${EXTRACTIONS_PER_RUN} extractions per run`);
  console.log(`[Scheduler] Note: Per-user schedules are respected (daily, weekly, etc.)`);

  // Validate cron expression
  if (!cron.validate(SCHEDULER_CHECK_INTERVAL)) {
    console.error(`[Scheduler] Invalid cron expression: ${SCHEDULER_CHECK_INTERVAL}`);
    return;
  }

  // Schedule the job - checks hourly, but only runs for users whose schedule is due
  cron.schedule(SCHEDULER_CHECK_INTERVAL, () => {
    runScheduledJob().catch(console.error);
  });

  console.log('[Scheduler] Scheduler started successfully');
}

// Manual trigger for testing - bypasses schedule check
export async function triggerManualRun(): Promise<{
  crawl: { crawled: number; documents: number; errors: string[] };
  extraction: { extracted: number; errors: string[] };
}> {
  if (isRunning) {
    throw new Error('Job already running');
  }

  isRunning = true;

  try {
    // Force=true bypasses the schedule check for manual triggers
    const crawl = await crawlSources({ force: true });
    const extraction = await runExtractions();

    // Track results
    lastRunAt = new Date().toISOString();
    lastRunResult = { crawl, extraction };

    return { crawl, extraction };
  } finally {
    isRunning = false;
  }
}

export function getSchedulerStatus(): {
  isRunning: boolean;
  checkInterval: string;
  lastRunAt: string | null;
  lastRunResult: {
    crawl: { crawled: number; documents: number; errors: string[] };
    extraction: { extracted: number; errors: string[] };
  } | null;
} {
  return { isRunning, checkInterval: SCHEDULER_CHECK_INTERVAL, lastRunAt, lastRunResult };
}
