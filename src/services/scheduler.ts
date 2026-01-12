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
import { extractFromContent, EXTRACTION_MODEL, getClaudeClient } from './claude';
import { getTemplatePrompt, isValidTemplateKey } from './templates';
import { getProfileContextForUser } from './profile';
import { TrendSource, DocumentInsert, ExtractionInsert, UserSettings, AssetInsert, AssetType } from '../types';

// Configuration
// Global schedule - how often the scheduler checks for work (not per-user schedule)
const SCHEDULER_CHECK_INTERVAL = process.env.SCHEDULER_CHECK_INTERVAL || '0 */1 * * *'; // Check every hour
const SOURCES_PER_RUN = parseInt(process.env.SOURCES_PER_RUN || '8', 10);
const ARTICLES_PER_SOURCE = parseInt(process.env.ARTICLES_PER_SOURCE || '5', 10);
const TWEETS_PER_SOURCE = parseInt(process.env.TWEETS_PER_SOURCE || '50', 10);
const EXTRACTIONS_PER_RUN = parseInt(process.env.EXTRACTIONS_PER_RUN || '10', 10);
const DELAY_BETWEEN_SOURCES_MS = 5000; // 5 seconds between sources
const DOCUMENT_RETENTION_DAYS = parseInt(process.env.DOCUMENT_RETENTION_DAYS || '30', 10);
const GENERATION_MODEL = 'claude-sonnet-4-20250514';
const EXTRACTIONS_FOR_GENERATION = 10; // Use top 10 recent extractions for auto-generation

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

  // Get active Tier 1 sources - prioritize Twitter sources first
  // First, get Twitter sources (always crawl these)
  const { data: twitterSources } = await db
    .from('trend_sources')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('tier', 1)
    .eq('crawl_method', 'twitter')
    .order('updated_at', { ascending: true })
    .limit(SOURCES_PER_RUN);

  // Then fill remaining slots with other sources
  const remainingSlots = SOURCES_PER_RUN - (twitterSources?.length || 0);
  const { data: otherSources } = remainingSlots > 0 ? await db
    .from('trend_sources')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('tier', 1)
    .neq('crawl_method', 'twitter')
    .order('updated_at', { ascending: true })
    .limit(remainingSlots) : { data: [] };

  // Combine: Twitter first, then others
  const sources = [...(twitterSources || []), ...(otherSources || [])];

  if (sources.length === 0) {
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
        // Use Twitter/Apify crawler - fetch more tweets than articles
        console.log(`[Scheduler] Detected Twitter source: ${crawlUrl}`);
        const tweets = await fetchFromTwitterSource(crawlUrl, {
          maxTweets: TWEETS_PER_SOURCE,
          minLikes: 3, // Lower threshold for tweets
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

/**
 * Clean up old documents and their extractions
 * Removes documents older than DOCUMENT_RETENTION_DAYS
 */
async function cleanupOldDocuments(): Promise<{ deleted: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];
  let deleted = 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DOCUMENT_RETENTION_DAYS);
  const cutoffIso = cutoffDate.toISOString();

  console.log(`[Scheduler] Cleaning up documents older than ${DOCUMENT_RETENTION_DAYS} days (before ${cutoffIso})`);

  try {
    // First, get IDs of old documents to delete their extractions
    const { data: oldDocs } = await db
      .from('documents')
      .select('id')
      .lt('created_at', cutoffIso);

    if (oldDocs && oldDocs.length > 0) {
      const oldDocIds = oldDocs.map((d: { id: string }) => d.id);

      // Delete extractions for these documents
      const { error: extractionError } = await db
        .from('extractions')
        .delete()
        .in('document_id', oldDocIds);

      if (extractionError) {
        errors.push(`Failed to delete extractions: ${extractionError.message}`);
      }

      // Delete the documents
      const { error: docError } = await db
        .from('documents')
        .delete()
        .lt('created_at', cutoffIso);

      if (docError) {
        errors.push(`Failed to delete documents: ${docError.message}`);
      } else {
        deleted = oldDocIds.length;
      }

      console.log(`[Scheduler] Cleaned up ${deleted} old documents`);
    } else {
      console.log('[Scheduler] No old documents to clean up');
    }
  } catch (err) {
    errors.push(`Cleanup error: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  return { deleted, errors };
}

// ============================================
// AUTO-GENERATION
// ============================================

interface UserSettingsForGeneration {
  user_id: string;
  generation_enabled: boolean;
  generation_schedule: string | null;
  generation_time: string | null;
  content_formats: string[] | null;
  last_generation_at: string | null;
  timezone: string | null;
}

/**
 * Check if a user should run auto-generation based on their schedule
 */
function shouldGenerateForUser(settings: UserSettingsForGeneration): boolean {
  const userId = settings.user_id;

  if (!settings.generation_enabled) {
    console.log(`[Scheduler] User ${userId}: generation_enabled is false`);
    return false;
  }
  if (!settings.generation_schedule || settings.generation_schedule === 'manual') {
    console.log(`[Scheduler] User ${userId}: generation_schedule is '${settings.generation_schedule}'`);
    return false;
  }
  if (!settings.content_formats || settings.content_formats.length === 0) {
    console.log(`[Scheduler] User ${userId}: no content_formats selected`);
    return false;
  }

  const userTz = settings.timezone || 'America/New_York';
  const now = new Date();

  // Get current time in user's timezone
  const userNow = new Date(now.toLocaleString('en-US', { timeZone: userTz }));
  const currentHour = userNow.getHours();
  const currentDay = userNow.getDay(); // 0 = Sunday, 1 = Monday, etc.

  // Parse generation_time (e.g., "08:00" or "08:00 AM")
  const generationTime = settings.generation_time || '08:00';
  // Handle both "08:00" and "08:00 AM" formats
  const timeMatch = generationTime.match(/^(\d{1,2})/);
  const targetHour = timeMatch ? parseInt(timeMatch[1], 10) : 8;

  console.log(`[Scheduler] User ${userId}: currentHour=${currentHour}, targetHour=${targetHour}, currentDay=${currentDay}, schedule=${settings.generation_schedule}`);

  // Check if we're within 2 hours after the target time (more lenient window)
  // This handles cases where the scheduler might have been down or delayed
  const hoursSinceTarget = currentHour - targetHour;
  if (hoursSinceTarget < 0 || hoursSinceTarget > 2) {
    console.log(`[Scheduler] User ${userId}: outside generation window (hoursSinceTarget=${hoursSinceTarget})`);
    return false;
  }

  // Check if schedule matches today
  const schedule = settings.generation_schedule;

  if (schedule === 'daily') {
    // Daily - check every day, OK
  } else if (schedule === 'weekly_sunday' && currentDay !== 0) {
    console.log(`[Scheduler] User ${userId}: weekly_sunday but today is day ${currentDay}`);
    return false;
  } else if (schedule === 'weekly_monday' && currentDay !== 1) {
    console.log(`[Scheduler] User ${userId}: weekly_monday but today is day ${currentDay}`);
    return false;
  } else if (!['daily', 'weekly_sunday', 'weekly_monday'].includes(schedule)) {
    console.log(`[Scheduler] User ${userId}: unknown schedule '${schedule}'`);
    return false;
  }

  // Check if we already generated today
  if (settings.last_generation_at) {
    const lastGen = new Date(settings.last_generation_at);
    const lastGenLocal = new Date(lastGen.toLocaleString('en-US', { timeZone: userTz }));

    // Same day check
    if (
      lastGenLocal.getFullYear() === userNow.getFullYear() &&
      lastGenLocal.getMonth() === userNow.getMonth() &&
      lastGenLocal.getDate() === userNow.getDate()
    ) {
      console.log(`[Scheduler] User ${userId}: already generated today (last: ${settings.last_generation_at})`);
      return false; // Already generated today
    }
  }

  console.log(`[Scheduler] User ${userId}: SHOULD GENERATE - all checks passed`);
  return true;
}

interface ExtractionWithSource {
  id: string;
  summary: string | null;
  key_points: string[] | null;
  topics: string[] | null;
  source_title: string | null;
  source_type: string | null;
}

function buildExtractionContext(extractions: ExtractionWithSource[]): string {
  return extractions
    .map((e, i) => {
      const header = `[${i + 1}] ${e.source_title || 'Untitled'} (${e.source_type || 'unknown'})`;
      const summary = e.summary || '';
      const keyPoints = e.key_points?.map((p) => `  - ${p}`).join('\n') || '';
      const topics = e.topics?.join(', ') || '';

      return `${header}\nSummary: ${summary}\nKey Points:\n${keyPoints}\nTopics: ${topics}`;
    })
    .join('\n\n---\n\n');
}

function mapFormatToAssetType(format: string): AssetType | null {
  const mapping: Record<string, AssetType> = {
    linkedin_post: 'linkedin_post',
    linkedin_pov: 'linkedin_post',
    twitter_post: 'twitter_post',
    twitter_thread: 'twitter_post',
    blog_post: 'blog_post',
    newsletter: 'newsletter',
    video_script: 'video_script',
    podcast_segment: 'podcast_segment',
  };

  return mapping[format] || null;
}

async function generateContentForFormat(
  prompt: string,
  extractions: ExtractionWithSource[],
  profileContext: string
): Promise<{ title: string; content: string }> {
  const claude = getClaudeClient();

  let fullPrompt = '';

  if (profileContext) {
    fullPrompt += `${profileContext}\n`;
  }

  fullPrompt += prompt;

  if (extractions.length > 0) {
    const extractionContext = buildExtractionContext(extractions);
    fullPrompt += `\n\n## Source Material:\n\n${extractionContext}`;
  }

  fullPrompt += '\n\n---\nGenerate content based on the most interesting and relevant insights from the source material above.';

  const response = await claude.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: fullPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse JSON from response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as { title: string; content: string };

  if (!parsed.title || !parsed.content) {
    throw new Error('Invalid response format');
  }

  return parsed;
}

async function runAutoGenerationForUser(userId: string, formats: string[]): Promise<{ generated: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];
  let generated = 0;

  console.log(`[Scheduler] Running auto-generation for user ${userId} with formats: ${formats.join(', ')}`);

  // Get recent extractions (from the past 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: extractions, error: fetchError } = await db
    .from('extractions')
    .select(`
      id,
      summary,
      key_points,
      topics,
      source_material_id,
      document_id,
      source_materials (title, type),
      documents (title)
    `)
    .eq('user_id', userId)
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(EXTRACTIONS_FOR_GENERATION);

  if (fetchError) {
    console.error(`[Scheduler] Failed to fetch extractions for user ${userId}:`, fetchError);
    return { generated: 0, errors: ['Failed to fetch extractions'] };
  }

  if (!extractions || extractions.length === 0) {
    console.log(`[Scheduler] No recent extractions for user ${userId}, skipping generation`);
    return { generated: 0, errors: [] };
  }

  // Transform extractions
  const extractionsWithSource: ExtractionWithSource[] = (extractions as any[]).map((e) => ({
    id: e.id,
    summary: e.summary,
    key_points: e.key_points,
    topics: e.topics,
    source_title: e.source_materials?.title ?? e.documents?.title ?? null,
    source_type: e.source_materials?.type ?? (e.document_id ? 'article' : null),
  }));

  console.log(`[Scheduler] Using ${extractionsWithSource.length} extractions for generation`);

  // Get user's content profile
  const profileContext = await getProfileContextForUser(userId);

  // Generate each format
  for (const format of formats) {
    try {
      if (!isValidTemplateKey(format)) {
        console.log(`[Scheduler] Skipping invalid format: ${format}`);
        continue;
      }

      console.log(`[Scheduler] Generating ${format}...`);

      const prompt = await getTemplatePrompt(format, userId);
      if (!prompt) {
        errors.push(`${format}: Template not found`);
        continue;
      }

      const result = await generateContentForFormat(prompt, extractionsWithSource, profileContext);

      // Save to assets
      const assetType = mapFormatToAssetType(format);
      if (!assetType) {
        errors.push(`${format}: Unknown asset type mapping`);
        continue;
      }

      const insert: AssetInsert = {
        user_id: userId,
        type: assetType,
        title: result.title,
        content: result.content,
        status: 'draft',
        publish_date: null,
        published_url: null,
      };

      const { data: asset, error: insertError } = await db
        .from('assets')
        .insert(insert)
        .select()
        .single();

      if (insertError) {
        errors.push(`${format}: ${insertError.message}`);
        continue;
      }

      generated++;
      console.log(`[Scheduler] Created ${format}: ${asset.id}`);
    } catch (err) {
      const msg = `${format}: ${err instanceof Error ? err.message : 'Unknown error'}`;
      console.error(`[Scheduler] Generation error:`, msg);
      errors.push(msg);
    }
  }

  // Update last_generation_at
  await db
    .from('user_settings')
    .update({ last_generation_at: new Date().toISOString() })
    .eq('user_id', userId);

  return { generated, errors };
}

async function runAutoGeneration(): Promise<{ generated: number; users: number; errors: string[] }> {
  const db = getDb();
  const allErrors: string[] = [];
  let totalGenerated = 0;
  let usersProcessed = 0;

  // Get all users with generation settings
  const { data: usersSettings } = await db
    .from('user_settings')
    .select('user_id, generation_enabled, generation_schedule, generation_time, content_formats, last_generation_at, timezone')
    .eq('generation_enabled', true);

  if (!usersSettings || usersSettings.length === 0) {
    console.log('[Scheduler] No users with auto-generation enabled');
    return { generated: 0, users: 0, errors: [] };
  }

  for (const settings of usersSettings as UserSettingsForGeneration[]) {
    if (!shouldGenerateForUser(settings)) {
      console.log(`[Scheduler] Skipping auto-generation for user ${settings.user_id} - not due (schedule: ${settings.generation_schedule}, time: ${settings.generation_time}, last: ${settings.last_generation_at})`);
      continue;
    }

    console.log(`[Scheduler] User ${settings.user_id} is due for auto-generation`);

    const formats = settings.content_formats || [];
    const result = await runAutoGenerationForUser(settings.user_id, formats);

    totalGenerated += result.generated;
    usersProcessed++;
    allErrors.push(...result.errors);
  }

  return { generated: totalGenerated, users: usersProcessed, errors: allErrors };
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

    // Step 3: Run auto-generation (checks each user's schedule)
    const generationResult = await runAutoGeneration();
    if (generationResult.generated > 0) {
      console.log(`[Scheduler] Auto-generation complete: ${generationResult.generated} assets for ${generationResult.users} users`);
    }

    // Step 4: Clean up old documents (runs daily)
    const cleanupResult = await cleanupOldDocuments();
    if (cleanupResult.deleted > 0) {
      console.log(`[Scheduler] Cleanup complete: ${cleanupResult.deleted} old documents removed`);
    }

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
  console.log(`[Scheduler] Config: ${SOURCES_PER_RUN} sources/run, ${ARTICLES_PER_SOURCE} articles/source, ${TWEETS_PER_SOURCE} tweets/source`);
  console.log(`[Scheduler] Cleanup: Documents older than ${DOCUMENT_RETENTION_DAYS} days will be removed`);
  console.log(`[Scheduler] Note: Twitter sources are prioritized and crawled first`);

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

// Manual trigger for auto-generation - bypasses schedule check
export async function triggerAutoGeneration(userId?: string): Promise<{
  generated: number;
  users: number;
  errors: string[];
}> {
  if (isRunning) {
    throw new Error('Job already running');
  }

  isRunning = true;
  console.log(`[Scheduler] Manual auto-generation triggered${userId ? ` for user ${userId}` : ' for all users'}`);

  try {
    const db = getDb();

    if (userId) {
      // Get specific user's settings
      const { data: settings } = await db
        .from('user_settings')
        .select('user_id, generation_enabled, generation_schedule, generation_time, content_formats, last_generation_at, timezone')
        .eq('user_id', userId)
        .single();

      if (!settings) {
        return { generated: 0, users: 0, errors: ['User settings not found'] };
      }

      // Force generation regardless of schedule
      const formats = settings.content_formats || [];
      if (formats.length === 0) {
        return { generated: 0, users: 0, errors: ['No content formats selected'] };
      }

      const result = await runAutoGenerationForUser(userId, formats);
      return { generated: result.generated, users: 1, errors: result.errors };
    } else {
      // Run for all users with generation enabled (bypasses schedule check)
      const { data: usersSettings } = await db
        .from('user_settings')
        .select('user_id, content_formats')
        .eq('generation_enabled', true);

      if (!usersSettings || usersSettings.length === 0) {
        return { generated: 0, users: 0, errors: ['No users with generation enabled'] };
      }

      let totalGenerated = 0;
      const allErrors: string[] = [];

      for (const settings of usersSettings) {
        const formats = settings.content_formats || [];
        if (formats.length === 0) continue;

        const result = await runAutoGenerationForUser(settings.user_id, formats);
        totalGenerated += result.generated;
        allErrors.push(...result.errors);
      }

      return { generated: totalGenerated, users: usersSettings.length, errors: allErrors };
    }
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
