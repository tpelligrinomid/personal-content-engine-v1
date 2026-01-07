/**
 * Twitter service using Apify
 *
 * Fetches tweets from accounts, hashtags, and search queries via Apify's Twitter scraper
 */

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const APIFY_TWITTER_ACTOR = 'apidojo/twitter-scraper-lite';
const APIFY_BASE_URL = 'https://api.apify.com/v2';

export interface ScrapedTweet {
  id: string;
  url: string;
  text: string;
  author: string;
  authorHandle: string;
  publishedAt: string;
  likes: number;
  retweets: number;
  replies: number;
}

interface ApifyTweetResult {
  id_str?: string;
  id?: string;
  full_text?: string;
  text?: string;
  url?: string;
  user?: {
    name?: string;
    screen_name?: string;
  };
  author?: {
    name?: string;
    userName?: string;
  };
  created_at?: string;
  createdAt?: string;
  favorite_count?: number;
  retweet_count?: number;
  reply_count?: number;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
}

interface ApifyRunResponse {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

interface TwitterSourceConfig {
  type: 'account' | 'hashtag' | 'search';
  value: string;
}

/**
 * Check if a URL is a Twitter/X URL
 */
export function isTwitterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'twitter.com' ||
           parsed.hostname === 'www.twitter.com' ||
           parsed.hostname === 'x.com' ||
           parsed.hostname === 'www.x.com';
  } catch {
    // Check for special twitter: prefix
    return url.startsWith('twitter:');
  }
}

/**
 * Parse a Twitter URL or special format into a source config
 *
 * Supports:
 * - https://twitter.com/username or https://x.com/username -> account
 * - https://twitter.com/hashtag/topic -> hashtag
 * - twitter:search:query -> search
 */
export function parseTwitterSource(input: string): TwitterSourceConfig | null {
  // Handle special twitter:search: prefix
  if (input.startsWith('twitter:search:')) {
    const query = input.replace('twitter:search:', '').trim();
    if (query) {
      return { type: 'search', value: query };
    }
    return null;
  }

  try {
    const url = new URL(input);
    const pathname = url.pathname;

    // Hashtag: /hashtag/topic
    const hashtagMatch = pathname.match(/^\/hashtag\/([^/]+)/i);
    if (hashtagMatch) {
      return { type: 'hashtag', value: hashtagMatch[1] };
    }

    // Account: /username (but not /home, /search, /explore, etc.)
    const reservedPaths = ['home', 'search', 'explore', 'notifications', 'messages', 'settings', 'i', 'hashtag'];
    const accountMatch = pathname.match(/^\/([^/]+)/);
    if (accountMatch && !reservedPaths.includes(accountMatch[1].toLowerCase())) {
      return { type: 'account', value: accountMatch[1] };
    }
  } catch {
    // Invalid URL
  }

  return null;
}

/**
 * Start an Apify actor run and wait for results
 */
async function runApifyActor(input: Record<string, unknown>): Promise<ApifyTweetResult[]> {
  if (!APIFY_API_KEY) {
    throw new Error('APIFY_API_KEY not configured');
  }

  // Start the actor run
  const runResponse = await fetch(
    `${APIFY_BASE_URL}/acts/${APIFY_TWITTER_ACTOR}/runs?token=${APIFY_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  if (!runResponse.ok) {
    const error = await runResponse.text();
    throw new Error(`Failed to start Apify run: ${error}`);
  }

  const runData = (await runResponse.json()) as ApifyRunResponse;
  const runId = runData.data.id;
  const datasetId = runData.data.defaultDatasetId;

  console.log(`[Twitter] Started Apify run: ${runId}`);

  // Poll for completion (max 2 minutes)
  const maxWaitTime = 120000;
  const pollInterval = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    const statusResponse = await fetch(
      `${APIFY_BASE_URL}/actor-runs/${runId}?token=${APIFY_API_KEY}`
    );

    if (!statusResponse.ok) {
      throw new Error('Failed to check run status');
    }

    const statusData = (await statusResponse.json()) as ApifyRunResponse;
    const status = statusData.data.status;

    if (status === 'SUCCEEDED') {
      console.log(`[Twitter] Run completed successfully`);
      break;
    } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${status}`);
    }

    // Still running, wait and poll again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Fetch results from dataset
  const datasetResponse = await fetch(
    `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${APIFY_API_KEY}&format=json`
  );

  if (!datasetResponse.ok) {
    throw new Error('Failed to fetch dataset results');
  }

  const results = (await datasetResponse.json()) as ApifyTweetResult[];
  console.log(`[Twitter] Fetched ${results.length} tweets`);

  return results;
}

/**
 * Normalize Apify tweet results to our format
 */
function normalizeTweet(tweet: ApifyTweetResult): ScrapedTweet | null {
  const id = tweet.id_str || tweet.id?.toString();
  const text = tweet.full_text || tweet.text;
  const authorName = tweet.user?.name || tweet.author?.name || 'Unknown';
  const authorHandle = tweet.user?.screen_name || tweet.author?.userName || 'unknown';
  const publishedAt = tweet.created_at || tweet.createdAt;

  if (!id || !text) {
    return null;
  }

  return {
    id,
    url: tweet.url || `https://twitter.com/${authorHandle}/status/${id}`,
    text,
    author: authorName,
    authorHandle,
    publishedAt: publishedAt || new Date().toISOString(),
    likes: tweet.favorite_count ?? tweet.likeCount ?? 0,
    retweets: tweet.retweet_count ?? tweet.retweetCount ?? 0,
    replies: tweet.reply_count ?? tweet.replyCount ?? 0,
  };
}

/**
 * Fetch tweets from a Twitter source
 */
export async function fetchFromTwitterSource(
  input: string,
  options: { maxTweets?: number; minLikes?: number } = {}
): Promise<ScrapedTweet[]> {
  const { maxTweets = 20, minLikes = 0 } = options;

  const source = parseTwitterSource(input);
  if (!source) {
    throw new Error(`Invalid Twitter source: ${input}`);
  }

  console.log(`[Twitter] Fetching ${source.type}: ${source.value}`);

  let apifyInput: Record<string, unknown>;

  switch (source.type) {
    case 'account':
      apifyInput = {
        twitterHandles: [source.value],
        maxTweets,
        mode: 'user',
      };
      break;
    case 'hashtag':
      apifyInput = {
        searchTerms: [`#${source.value}`],
        maxTweets,
        mode: 'search',
      };
      break;
    case 'search':
      apifyInput = {
        searchTerms: [source.value],
        maxTweets,
        mode: 'search',
      };
      break;
  }

  const rawTweets = await runApifyActor(apifyInput);

  // Normalize and filter
  const tweets = rawTweets
    .map(normalizeTweet)
    .filter((t): t is ScrapedTweet => t !== null)
    .filter((t) => t.likes >= minLikes);

  console.log(`[Twitter] Returning ${tweets.length} tweets (filtered by ${minLikes}+ likes)`);

  return tweets;
}

/**
 * Format a tweet for storage as document content
 */
export function formatTweetAsContent(tweet: ScrapedTweet): string {
  return `Tweet by @${tweet.authorHandle} (${tweet.author})

${tweet.text}

---
Likes: ${tweet.likes} | Retweets: ${tweet.retweets} | Replies: ${tweet.replies}
Posted: ${new Date(tweet.publishedAt).toLocaleDateString()}`;
}
