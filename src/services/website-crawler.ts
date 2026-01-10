/**
 * Website Crawler Service
 *
 * Fetches pages from a user's publishing website for internal linking suggestions.
 * Tries sitemap.xml first, falls back to common blog paths.
 */

export interface WebsitePage {
  url: string;
  title: string | null;
  lastModified: string | null;
}

interface SitemapUrl {
  loc: string;
  lastmod?: string;
}

/**
 * Parse a simple XML sitemap
 * Handles basic sitemap format without external dependencies
 */
function parseSitemap(xml: string): SitemapUrl[] {
  const urls: SitemapUrl[] = [];

  // Match all <url> blocks
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];

  for (const block of urlBlocks) {
    // Extract <loc> - required
    const locMatch = block.match(/<loc>\s*(.*?)\s*<\/loc>/i);
    if (!locMatch) continue;

    const loc = locMatch[1].trim();

    // Extract <lastmod> - optional
    const lastmodMatch = block.match(/<lastmod>\s*(.*?)\s*<\/lastmod>/i);
    const lastmod = lastmodMatch ? lastmodMatch[1].trim() : undefined;

    urls.push({ loc, lastmod });
  }

  return urls;
}

/**
 * Extract title from HTML page
 */
function extractTitle(html: string): string | null {
  // Try <title> tag
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim().replace(/\s*[|\-–—].*$/, '').trim(); // Remove site name suffix
  }

  // Try og:title
  const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch) {
    return ogMatch[1].trim();
  }

  // Try h1
  const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
  if (h1Match) {
    return h1Match[1].replace(/<[^>]+>/g, '').trim();
  }

  return null;
}

/**
 * Filter URLs to only include content pages (blog posts, articles)
 */
function isContentUrl(url: string, baseUrl: string): boolean {
  try {
    const parsed = new URL(url);
    const base = new URL(baseUrl);

    // Must be same domain
    if (parsed.hostname !== base.hostname) return false;

    const path = parsed.pathname.toLowerCase();

    // Exclude common non-content pages
    const excludePatterns = [
      /^\/?$/, // Homepage
      /^\/?(tag|category|author|page|search|contact|about|privacy|terms|login|signup|register|cart|checkout|account)/i,
      /\.(xml|json|rss|atom|txt|css|js|ico|png|jpg|jpeg|gif|svg|pdf|zip)$/i,
      /\/feed\/?$/i,
      /\/wp-admin/i,
      /\/wp-content/i,
    ];

    for (const pattern of excludePatterns) {
      if (pattern.test(path)) return false;
    }

    // Include patterns that look like blog/article URLs
    const includePatterns = [
      /\/blog\//i,
      /\/post\//i,
      /\/article\//i,
      /\/news\//i,
      /\/\d{4}\/\d{2}\//i, // Date-based URLs like /2024/01/
      /\/[a-z0-9-]+\/?$/i, // Slug-style URLs
    ];

    // If it matches an include pattern, definitely include
    for (const pattern of includePatterns) {
      if (pattern.test(path)) return true;
    }

    // Include if path has at least 2 segments (likely a post)
    const segments = path.split('/').filter(Boolean);
    return segments.length >= 1;
  } catch {
    return false;
  }
}

/**
 * Fetch and parse sitemap from a website
 */
async function fetchSitemap(baseUrl: string): Promise<SitemapUrl[]> {
  const sitemapUrls = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/post-sitemap.xml`,
    `${baseUrl}/blog-sitemap.xml`,
  ];

  for (const sitemapUrl of sitemapUrls) {
    try {
      console.log(`[WebsiteCrawler] Trying sitemap: ${sitemapUrl}`);
      const response = await fetch(sitemapUrl, {
        headers: { 'User-Agent': 'PersonalContentEngine/1.0' },
      });

      if (!response.ok) continue;

      const xml = await response.text();

      // Check if it's a sitemap index (contains other sitemaps)
      if (xml.includes('<sitemapindex')) {
        const indexUrls = parseSitemapIndex(xml);
        const allUrls: SitemapUrl[] = [];

        for (const indexUrl of indexUrls.slice(0, 3)) { // Limit to first 3 sub-sitemaps
          try {
            const subResponse = await fetch(indexUrl, {
              headers: { 'User-Agent': 'PersonalContentEngine/1.0' },
            });
            if (subResponse.ok) {
              const subXml = await subResponse.text();
              allUrls.push(...parseSitemap(subXml));
            }
          } catch {
            // Skip failed sub-sitemaps
          }
        }

        if (allUrls.length > 0) {
          console.log(`[WebsiteCrawler] Found ${allUrls.length} URLs from sitemap index`);
          return allUrls;
        }
      }

      const urls = parseSitemap(xml);
      if (urls.length > 0) {
        console.log(`[WebsiteCrawler] Found ${urls.length} URLs from sitemap`);
        return urls;
      }
    } catch (err) {
      console.log(`[WebsiteCrawler] Failed to fetch ${sitemapUrl}:`, err);
    }
  }

  return [];
}

/**
 * Parse sitemap index to get individual sitemap URLs
 */
function parseSitemapIndex(xml: string): string[] {
  const urls: string[] = [];
  const locMatches = xml.match(/<loc>\s*(.*?)\s*<\/loc>/gi) || [];

  for (const match of locMatches) {
    const url = match.replace(/<\/?loc>/gi, '').trim();
    if (url.endsWith('.xml')) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Fetch title for a URL by loading the page
 */
async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'PersonalContentEngine/1.0' },
    });

    if (!response.ok) return null;

    // Only read first 50KB for title extraction
    const reader = response.body?.getReader();
    if (!reader) return null;

    let html = '';
    const decoder = new TextDecoder();

    while (html.length < 50000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });

      // Stop early if we found a title
      if (html.includes('</title>') || html.includes('</head>')) {
        break;
      }
    }

    reader.cancel();
    return extractTitle(html);
  } catch {
    return null;
  }
}

/**
 * Crawl a website and return a list of content pages
 *
 * @param websiteUrl - The base URL of the website (e.g., "https://myblog.com")
 * @param options - Crawl options
 * @returns List of pages with URLs and titles
 */
export async function crawlWebsitePages(
  websiteUrl: string,
  options: { maxPages?: number; fetchTitles?: boolean } = {}
): Promise<WebsitePage[]> {
  const { maxPages = 100, fetchTitles = true } = options;

  // Normalize URL
  let baseUrl = websiteUrl.trim();
  if (!baseUrl.startsWith('http')) {
    baseUrl = `https://${baseUrl}`;
  }
  baseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes

  console.log(`[WebsiteCrawler] Crawling website: ${baseUrl}`);

  // Try to get pages from sitemap
  const sitemapUrls = await fetchSitemap(baseUrl);

  // Filter to content URLs only
  const contentUrls = sitemapUrls
    .filter((item) => isContentUrl(item.loc, baseUrl))
    .slice(0, maxPages);

  console.log(`[WebsiteCrawler] Found ${contentUrls.length} content URLs`);

  // Build page list
  const pages: WebsitePage[] = [];

  for (const item of contentUrls) {
    let title: string | null = null;

    // Fetch title if requested (rate limited)
    if (fetchTitles && pages.length < 50) { // Only fetch titles for first 50
      title = await fetchPageTitle(item.loc);
      // Small delay to be nice to servers
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Generate title from URL slug if not found
    if (!title) {
      const slug = new URL(item.loc).pathname.split('/').filter(Boolean).pop();
      if (slug) {
        title = slug
          .replace(/[-_]/g, ' ')
          .replace(/\.(html?|php|aspx?)$/i, '')
          .split(' ')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
    }

    pages.push({
      url: item.loc,
      title,
      lastModified: item.lastmod || null,
    });
  }

  console.log(`[WebsiteCrawler] Returning ${pages.length} pages with titles`);

  return pages;
}
