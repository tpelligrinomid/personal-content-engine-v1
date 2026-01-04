/**
 * Firecrawl API client for web scraping
 */

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1';

function getApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) {
    throw new Error('Missing FIRECRAWL_API_KEY environment variable');
  }
  return key;
}

interface FirecrawlScrapeResult {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
      ogUrl?: string;
      publishedTime?: string;
      author?: string;
    };
  };
  error?: string;
}

interface FirecrawlMapResult {
  success: boolean;
  links?: string[];
  error?: string;
}

interface FirecrawlCrawlStartResult {
  success: boolean;
  id?: string;
  error?: string;
}

interface FirecrawlCrawlStatusResult {
  success: boolean;
  status: 'scraping' | 'completed' | 'failed';
  completed: number;
  total: number;
  data?: Array<{
    markdown?: string;
    metadata?: {
      title?: string;
      sourceURL?: string;
      publishedTime?: string;
      author?: string;
    };
  }>;
  error?: string;
}

export interface ScrapedPage {
  url: string;
  title: string | null;
  content: string;
  author: string | null;
  publishedAt: string | null;
}

/**
 * Scrape a single URL
 */
export async function scrapePage(url: string): Promise<ScrapedPage> {
  const response = await fetch(`${FIRECRAWL_API_URL}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
    }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl API error: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as FirecrawlScrapeResult;

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to scrape page');
  }

  return {
    url: result.data.metadata?.sourceURL || url,
    title: result.data.metadata?.title || null,
    content: result.data.markdown || '',
    author: result.data.metadata?.author || null,
    publishedAt: result.data.metadata?.publishedTime || null,
  };
}

/**
 * Map a URL to discover all linked pages (useful for finding blog posts)
 */
export async function mapSite(url: string, limit = 50): Promise<string[]> {
  const response = await fetch(`${FIRECRAWL_API_URL}/map`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      url,
      limit,
    }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl API error: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as FirecrawlMapResult;

  if (!result.success || !result.links) {
    throw new Error(result.error || 'Failed to map site');
  }

  return result.links;
}

/**
 * Start a crawl job (async - returns job ID)
 */
export async function startCrawl(
  url: string,
  options: {
    limit?: number;
    maxDepth?: number;
    includePaths?: string[];
    excludePaths?: string[];
  } = {}
): Promise<string> {
  const response = await fetch(`${FIRECRAWL_API_URL}/crawl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      url,
      limit: options.limit || 20,
      maxDepth: options.maxDepth || 2,
      includePaths: options.includePaths,
      excludePaths: options.excludePaths,
      scrapeOptions: {
        formats: ['markdown'],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl API error: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as FirecrawlCrawlStartResult;

  if (!result.success || !result.id) {
    throw new Error(result.error || 'Failed to start crawl');
  }

  return result.id;
}

/**
 * Check crawl job status
 */
export async function getCrawlStatus(crawlId: string): Promise<FirecrawlCrawlStatusResult> {
  const response = await fetch(`${FIRECRAWL_API_URL}/crawl/${crawlId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Firecrawl API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as FirecrawlCrawlStatusResult;
}

/**
 * Crawl and wait for completion (with timeout)
 */
export async function crawlAndWait(
  url: string,
  options: {
    limit?: number;
    maxDepth?: number;
    includePaths?: string[];
    excludePaths?: string[];
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {}
): Promise<ScrapedPage[]> {
  const crawlId = await startCrawl(url, options);

  const timeout = options.timeoutMs || 120000; // 2 minutes default
  const pollInterval = options.pollIntervalMs || 5000; // 5 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const status = await getCrawlStatus(crawlId);

    if (status.status === 'completed') {
      return (status.data || []).map((page) => ({
        url: page.metadata?.sourceURL || '',
        title: page.metadata?.title || null,
        content: page.markdown || '',
        author: page.metadata?.author || null,
        publishedAt: page.metadata?.publishedTime || null,
      }));
    }

    if (status.status === 'failed') {
      throw new Error(status.error || 'Crawl failed');
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error('Crawl timed out');
}

/**
 * Quick crawl for blogs - maps the site then scrapes individual articles
 * More efficient for blog index pages
 */
export async function crawlBlog(
  blogUrl: string,
  options: {
    limit?: number;
    articlePathPattern?: RegExp;
  } = {}
): Promise<ScrapedPage[]> {
  const limit = options.limit || 10;

  // First, map the site to find all URLs
  console.log(`Mapping ${blogUrl}...`);
  const allUrls = await mapSite(blogUrl, limit * 2);

  // Filter to likely article URLs (exclude index, category, tag pages)
  const articleUrls = allUrls.filter((url) => {
    // Skip the exact blog index URL
    if (url === blogUrl || url === blogUrl + '/') return false;

    // Skip common non-article patterns
    const skipPatterns = [
      /\/page\/\d+/,
      /\/category\//,
      /\/tag\//,
      /\/author\//,
      /\/search/,
      /\/archive/,
      /\/#/,
      /\/feed/,
      /\.xml$/,
      /\/wp-admin/,
      /\/wp-content/,
    ];

    for (const pattern of skipPatterns) {
      if (pattern.test(url)) return false;
    }

    // If custom pattern provided, use it
    if (options.articlePathPattern) {
      return options.articlePathPattern.test(url);
    }

    return true;
  });

  console.log(`Found ${articleUrls.length} potential articles, scraping up to ${limit}...`);

  // Scrape each article (up to limit)
  const pages: ScrapedPage[] = [];

  for (const url of articleUrls.slice(0, limit)) {
    try {
      console.log(`Scraping: ${url}`);
      const page = await scrapePage(url);
      pages.push(page);
    } catch (err) {
      console.error(`Failed to scrape ${url}:`, err);
    }
  }

  return pages;
}
