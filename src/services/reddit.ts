/**
 * Reddit API client for fetching subreddit posts
 *
 * Uses Reddit's public JSON API (no auth required for read-only)
 */

export interface RedditPost {
  id: string;
  title: string;
  url: string;
  permalink: string;
  selftext: string;
  author: string;
  score: number;
  num_comments: number;
  created_utc: number;
  subreddit: string;
  is_self: boolean;
  link_flair_text: string | null;
}

export interface ScrapedRedditPost {
  url: string;
  title: string;
  content: string;
  author: string;
  publishedAt: string;
  subreddit: string;
  score: number;
  comments: number;
}

interface RedditListingResponse {
  kind: string;
  data: {
    children: Array<{
      kind: string;
      data: RedditPost;
    }>;
    after: string | null;
    before: string | null;
  };
}

// Reddit requires a custom User-Agent
const USER_AGENT = 'ContentEngine/1.0 (content aggregation for personal use)';

/**
 * Extract subreddit name from various URL formats
 */
export function parseRedditUrl(url: string): { subreddit: string; sort: string } | null {
  // Handle various Reddit URL formats:
  // - https://www.reddit.com/r/marketing
  // - https://reddit.com/r/marketing
  // - https://old.reddit.com/r/marketing
  // - r/marketing
  // - /r/marketing

  const patterns = [
    /(?:https?:\/\/)?(?:www\.|old\.)?reddit\.com\/r\/([^\/\s?]+)(?:\/([^\/\s?]+))?/i,
    /^r\/([^\/\s?]+)(?:\/([^\/\s?]+))?$/i,
    /^\/r\/([^\/\s?]+)(?:\/([^\/\s?]+))?$/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        subreddit: match[1],
        sort: match[2] || 'hot', // default to hot
      };
    }
  }

  return null;
}

/**
 * Check if a URL is a Reddit URL
 */
export function isRedditUrl(url: string): boolean {
  return parseRedditUrl(url) !== null;
}

/**
 * Fetch posts from a subreddit
 */
export async function fetchSubreddit(
  subreddit: string,
  options: {
    sort?: 'hot' | 'new' | 'top' | 'rising';
    time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
    limit?: number;
  } = {}
): Promise<ScrapedRedditPost[]> {
  const sort = options.sort || 'hot';
  const limit = Math.min(options.limit || 10, 100); // Reddit max is 100

  let url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`;

  // Add time parameter for 'top' sort
  if (sort === 'top' && options.time) {
    url += `&t=${options.time}`;
  }

  console.log(`[Reddit] Fetching ${url}`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Subreddit r/${subreddit} not found`);
    }
    if (response.status === 403) {
      throw new Error(`Subreddit r/${subreddit} is private or quarantined`);
    }
    if (response.status === 429) {
      throw new Error('Reddit rate limit exceeded - try again later');
    }
    throw new Error(`Reddit API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as RedditListingResponse;

  if (!data.data?.children) {
    return [];
  }

  // Filter and transform posts
  const posts: ScrapedRedditPost[] = data.data.children
    .filter((child) => child.kind === 't3') // t3 = link/post
    .map((child) => {
      const post = child.data;

      // Build content from title + selftext (for text posts) or title + link info
      let content = `# ${post.title}\n\n`;

      if (post.is_self && post.selftext) {
        // Text post - include the body
        content += post.selftext;
      } else if (!post.is_self) {
        // Link post - mention what it links to
        content += `[Link to: ${post.url}]\n\n`;
        if (post.selftext) {
          content += post.selftext;
        }
      }

      // Add metadata
      content += `\n\n---\nPosted by u/${post.author} in r/${post.subreddit}`;
      content += `\nScore: ${post.score} | Comments: ${post.num_comments}`;
      if (post.link_flair_text) {
        content += ` | Flair: ${post.link_flair_text}`;
      }

      return {
        url: `https://www.reddit.com${post.permalink}`,
        title: post.title,
        content,
        author: post.author,
        publishedAt: new Date(post.created_utc * 1000).toISOString(),
        subreddit: post.subreddit,
        score: post.score,
        comments: post.num_comments,
      };
    });

  console.log(`[Reddit] Found ${posts.length} posts from r/${subreddit}`);

  return posts;
}

/**
 * Fetch posts from a subreddit URL
 * Convenience function that parses the URL and fetches posts
 */
export async function fetchFromRedditUrl(
  url: string,
  options: {
    limit?: number;
    minScore?: number;
  } = {}
): Promise<ScrapedRedditPost[]> {
  const parsed = parseRedditUrl(url);

  if (!parsed) {
    throw new Error(`Invalid Reddit URL: ${url}`);
  }

  const sort = parsed.sort as 'hot' | 'new' | 'top' | 'rising';

  let posts = await fetchSubreddit(parsed.subreddit, {
    sort: ['hot', 'new', 'top', 'rising'].includes(sort) ? sort : 'hot',
    time: sort === 'top' ? 'week' : undefined, // Default to weekly top for /top
    limit: options.limit,
  });

  // Filter by minimum score if specified
  if (options.minScore && options.minScore > 0) {
    posts = posts.filter((post) => post.score >= options.minScore!);
    console.log(`[Reddit] Filtered to ${posts.length} posts with score >= ${options.minScore}`);
  }

  return posts;
}
