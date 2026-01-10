/**
 * Content Enrichment API
 *
 * POST /api/assets/:id/enrich - Enrich an asset with links, quotes, and image ideas
 */

import { IncomingMessage, ServerResponse } from 'http';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
import { crawlWebsitePages, WebsitePage } from '../services/website-crawler';
import { Asset, AssetType } from '../types';

const anthropic = new Anthropic();
const ENRICHMENT_MODEL = 'claude-sonnet-4-20250514';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface EnrichmentResult {
  enriched_content: string;
  metadata: {
    internal_links_added: number;
    external_links_added: number;
    pull_quotes_added: number;
    image_suggestions_added: number;
  };
  type_specific: Record<string, string>;
}

function sendJson(res: ServerResponse, status: number, data: ApiResponse): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function extractAssetIdFromPath(pathname: string): string | null {
  const match = pathname.match(/\/api\/assets\/([^/]+)\/enrich$/);
  return match ? match[1] : null;
}

/**
 * Build the enrichment prompt based on asset type
 */
function buildEnrichmentPrompt(
  asset: Asset,
  websitePages: WebsitePage[],
  assetType: AssetType
): string {
  const internalLinksSection = websitePages.length > 0
    ? `
## Available Internal Links (from the user's website)
These are existing pages on the user's website that you can link to where relevant:

${websitePages.map((p) => `- "${p.title || 'Untitled'}" - ${p.url}`).join('\n')}

When adding internal links, use the exact URLs provided above. Only link where genuinely relevant to the content.
`
    : `
## Internal Links
No website pages were found. Skip internal linking for this enrichment.
`;

  const typeSpecificInstructions = getTypeSpecificInstructions(assetType);

  return `You are a content enrichment specialist. Your job is to take existing content and enhance it with:

1. **Pull Quotes** - Extract 2-4 impactful sentences from the content and format them as blockquotes. These should be memorable, shareable statements that capture key insights.

2. **External Links** - Add authoritative external citations and references. Link to reputable sources (industry publications, research, well-known experts) that support or expand on points made in the content. Use markdown link format: [anchor text](url)

3. **Internal Links** - Add links to the user's own content where relevant. This helps with SEO and keeps readers engaged.

4. **Image Suggestions** - Add 2-3 image placeholders with descriptive alt text that describes what image would work well. Format as: ![Image: description of suggested image]

${internalLinksSection}

${typeSpecificInstructions}

## Original Content

Title: ${asset.title || 'Untitled'}
Type: ${assetType}

---
${asset.content}
---

## Your Task

Rewrite the content in clean Markdown format with all enrichments applied:
- Pull quotes should be formatted as blockquotes (> quote text)
- Links should be inline markdown links
- Image suggestions should be markdown image syntax with descriptive alt text
- Preserve the original meaning and voice
- Don't add fluff or significantly change the length
- Make sure external links go to real, authoritative websites (you can suggest plausible URLs based on your knowledge)

${assetType === 'blog_post' ? `
At the very top, add a metadata block:
\`\`\`
Meta Description: [60-160 char SEO description]
SEO Title: [optimized title, 50-60 chars]
\`\`\`
` : ''}

${assetType === 'newsletter' ? `
At the very top, add:
\`\`\`
Subject Line Options:
1. [option 1]
2. [option 2]
3. [option 3]

Preview Text: [40-90 chars preview]
\`\`\`
` : ''}

Output ONLY the enriched markdown content. Do not include any explanations or commentary.`;
}

/**
 * Get type-specific enrichment instructions
 */
function getTypeSpecificInstructions(assetType: AssetType): string {
  switch (assetType) {
    case 'blog_post':
      return `
## Blog Post Specific Instructions
- Add more external links (aim for 3-5 authoritative sources)
- Include a featured image suggestion at the top
- Ensure good heading structure (H2, H3)
- Pull quotes can be longer and more detailed
- Consider adding a brief "Key Takeaways" or "TL;DR" section if the content is long
`;

    case 'newsletter':
      return `
## Newsletter Specific Instructions
- External links should be fewer but high-value (1-3 max)
- Pull quotes should be short and punchy
- Consider the reading experience on email
- Add a clear call-to-action (CTA) near the end if not present
- Keep formatting simple (email clients have limitations)
`;

    case 'linkedin_post':
      return `
## LinkedIn Post Specific Instructions
- Minimal external links (0-1)
- Pull quotes become "hook" statements at the start
- No images needed (LinkedIn posts are text-focused)
- Keep it conversational and personal
- Add line breaks for readability
`;

    case 'twitter_post':
      return `
## Twitter/X Specific Instructions
- No external links unless essential
- No pull quotes (too short)
- No images in output
- Focus on tightening language
`;

    default:
      return `
## General Enrichment
- Balance external and internal links
- Add pull quotes where impactful
- Include image suggestions where relevant
`;
  }
}

/**
 * Count enrichments in the result
 */
function countEnrichments(original: string, enriched: string): {
  internal_links_added: number;
  external_links_added: number;
  pull_quotes_added: number;
  image_suggestions_added: number;
} {
  // Count markdown links in enriched that weren't in original
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const originalLinks = new Set([...original.matchAll(linkRegex)].map((m) => m[2]));
  const enrichedLinks = [...enriched.matchAll(linkRegex)].map((m) => m[2]);

  let internalLinks = 0;
  let externalLinks = 0;

  for (const url of enrichedLinks) {
    if (!originalLinks.has(url)) {
      if (url.startsWith('/') || url.includes('localhost')) {
        internalLinks++;
      } else {
        externalLinks++;
      }
    }
  }

  // Count blockquotes
  const originalQuotes = (original.match(/^>\s/gm) || []).length;
  const enrichedQuotes = (enriched.match(/^>\s/gm) || []).length;
  const pullQuotes = Math.max(0, enrichedQuotes - originalQuotes);

  // Count image suggestions
  const originalImages = (original.match(/!\[/g) || []).length;
  const enrichedImages = (enriched.match(/!\[/g) || []).length;
  const imageSuggestions = Math.max(0, enrichedImages - originalImages);

  return {
    internal_links_added: internalLinks,
    external_links_added: externalLinks,
    pull_quotes_added: pullQuotes,
    image_suggestions_added: imageSuggestions,
  };
}

/**
 * Extract type-specific metadata from enriched content
 */
function extractTypeSpecificMetadata(content: string, assetType: AssetType): Record<string, string> {
  const metadata: Record<string, string> = {};

  if (assetType === 'blog_post') {
    const metaMatch = content.match(/Meta Description:\s*(.+)/i);
    const seoMatch = content.match(/SEO Title:\s*(.+)/i);

    if (metaMatch) metadata.meta_description = metaMatch[1].trim();
    if (seoMatch) metadata.seo_title = seoMatch[1].trim();
  }

  if (assetType === 'newsletter') {
    const subjectMatches = content.match(/Subject Line Options?:[\s\S]*?(?=Preview Text:|```|$)/i);
    const previewMatch = content.match(/Preview Text:\s*(.+)/i);

    if (subjectMatches) {
      const lines = subjectMatches[0].split('\n').filter((l) => /^\d+\./.test(l.trim()));
      metadata.subject_lines = lines.map((l) => l.replace(/^\d+\.\s*/, '').trim()).join(' | ');
    }
    if (previewMatch) metadata.preview_text = previewMatch[1].trim();
  }

  return metadata;
}

async function handleEnrich(
  req: IncomingMessage,
  res: ServerResponse,
  assetId: string
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const db = getDb();

    console.log(`[Enrich] Starting enrichment for asset ${assetId}`);

    // Get the asset
    const { data: asset, error: assetError } = await db
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .eq('user_id', userId)
      .single();

    if (assetError || !asset) {
      sendJson(res, 404, { success: false, error: 'Asset not found' });
      return;
    }

    // Get user's publishing website URL
    const { data: settings } = await db
      .from('user_settings')
      .select('publishing_website_url')
      .eq('user_id', userId)
      .single();

    const websiteUrl = settings?.publishing_website_url;

    // Crawl website for internal links (if URL provided)
    let websitePages: WebsitePage[] = [];
    if (websiteUrl) {
      console.log(`[Enrich] Crawling website: ${websiteUrl}`);
      try {
        websitePages = await crawlWebsitePages(websiteUrl, {
          maxPages: 50,
          fetchTitles: true,
        });
        console.log(`[Enrich] Found ${websitePages.length} pages for internal linking`);
      } catch (err) {
        console.error('[Enrich] Website crawl failed:', err);
        // Continue without internal links
      }
    } else {
      console.log('[Enrich] No publishing website configured, skipping internal links');
    }

    // Build the enrichment prompt
    const prompt = buildEnrichmentPrompt(asset as Asset, websitePages, asset.type as AssetType);

    console.log(`[Enrich] Calling Claude (${ENRICHMENT_MODEL}) for enrichment`);

    // Call Claude for enrichment
    const response = await anthropic.messages.create({
      model: ENRICHMENT_MODEL,
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const enrichedContent = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    if (!enrichedContent) {
      sendJson(res, 500, { success: false, error: 'Failed to generate enriched content' });
      return;
    }

    // Count what was added
    const metadata = countEnrichments(asset.content, enrichedContent);
    const typeSpecific = extractTypeSpecificMetadata(enrichedContent, asset.type as AssetType);

    console.log(`[Enrich] Enrichment complete:`, metadata);

    const result: EnrichmentResult = {
      enriched_content: enrichedContent,
      metadata,
      type_specific: typeSpecific,
    };

    sendJson(res, 200, { success: true, data: result });
  } catch (err) {
    console.error('[Enrich] Error:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export async function handleEnrichment(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const assetId = extractAssetIdFromPath(pathname);

  if (!assetId) {
    sendJson(res, 400, { success: false, error: 'Asset ID required' });
    return;
  }

  if (req.method === 'POST') {
    return handleEnrich(req, res, assetId);
  }

  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}
