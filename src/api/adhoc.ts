/**
 * Ad-hoc Content Generation API
 *
 * POST /api/generate/adhoc - Generate content from specific extractions
 *
 * Allows on-demand generation from selected sources using any template.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { getDb } from '../services/db';
import { requireUserId } from '../middleware/auth';
import { getClaudeClient } from '../services/claude';
import { getTemplatePrompt, isValidTemplateKey } from '../services/templates';
import { getProfileContextForUser } from '../services/profile';
import { Asset, AssetInsert, AssetInputInsert, Extraction } from '../types';

const GENERATION_MODEL = 'claude-opus-4-5-20251101';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface AdhocRequest {
  extraction_ids?: string[];
  asset_ids?: string[];
  formats: string[];
  instructions?: string;
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

function validateRequest(body: unknown): body is AdhocRequest {
  if (typeof body !== 'object' || body === null) return false;

  const obj = body as Record<string, unknown>;

  // formats is always required
  if (!Array.isArray(obj.formats) || obj.formats.length === 0) {
    return false;
  }

  // At least one source must be provided: extraction_ids, asset_ids, or instructions
  const hasExtractions = Array.isArray(obj.extraction_ids) && obj.extraction_ids.length > 0;
  const hasAssets = Array.isArray(obj.asset_ids) && obj.asset_ids.length > 0;
  const hasInstructions = typeof obj.instructions === 'string' && obj.instructions.trim().length > 0;

  if (!hasExtractions && !hasAssets && !hasInstructions) {
    return false;
  }

  return true;
}

interface ExtractionWithSource {
  id: string;
  summary: string | null;
  key_points: string[] | null;
  topics: string[] | null;
  source_material_id: string | null;
  document_id: string | null;
  source_title: string | null;
  source_type: string | null;
}

interface SourceAsset {
  id: string;
  type: string;
  title: string | null;
  content: string;
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

function buildAssetContext(assets: SourceAsset[]): string {
  return assets
    .map((a, i) => {
      const typeLabel = a.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const header = `[Source ${i + 1}] ${a.title || 'Untitled'} (${typeLabel})`;
      return `${header}\n\n${a.content}`;
    })
    .join('\n\n---\n\n');
}

async function generateContent(
  prompt: string,
  extractions: ExtractionWithSource[],
  sourceAssets: SourceAsset[],
  profileContext: string,
  instructions?: string
): Promise<{ title: string; content: string }> {
  const claude = getClaudeClient();

  // Build full prompt with profile context prepended
  let fullPrompt = '';

  if (profileContext) {
    fullPrompt += `${profileContext}\n`;
  }

  fullPrompt += prompt;

  // Add source asset context if available
  if (sourceAssets.length > 0) {
    const assetContext = buildAssetContext(sourceAssets);
    fullPrompt += `\n\n## Existing Content to Build From:\n\n${assetContext}`;
  }

  // Add extraction context if available
  if (extractions.length > 0) {
    const extractionContext = buildExtractionContext(extractions);
    fullPrompt += `\n\n## Additional Source Material:\n\n${extractionContext}`;
  }

  // Add custom instructions
  const hasSources = extractions.length > 0 || sourceAssets.length > 0;
  if (instructions) {
    if (!hasSources) {
      // Prompt-only mode: instructions are the main content direction
      fullPrompt += `\n\n---\nContent direction and topic:\n${instructions}`;
    } else {
      // With sources: instructions are additional guidance
      fullPrompt += `\n\n---\nAdditional instructions: ${instructions}`;
    }
  }

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

function mapFormatToAssetType(format: string): Asset['type'] | null {
  const mapping: Record<string, Asset['type']> = {
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

export async function handleAdhoc(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = await parseBody(req);

    if (!validateRequest(body)) {
      sendJson(res, 400, {
        success: false,
        error: 'Invalid request. Required: formats (array), and at least one of: extraction_ids (array), asset_ids (array), or instructions (string)',
      });
      return;
    }

    // Validate formats
    const invalidFormats = body.formats.filter((f) => !isValidTemplateKey(f));
    if (invalidFormats.length > 0) {
      sendJson(res, 400, {
        success: false,
        error: `Unknown formats: ${invalidFormats.join(', ')}`,
      });
      return;
    }

    const db = getDb();

    // Fetch extractions if IDs provided
    let extractionsWithSource: ExtractionWithSource[] = [];

    if (body.extraction_ids && body.extraction_ids.length > 0) {
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
        .in('id', body.extraction_ids);

      if (fetchError) {
        sendJson(res, 500, { success: false, error: 'Failed to fetch extractions' });
        return;
      }

      if (!extractions || extractions.length === 0) {
        sendJson(res, 404, { success: false, error: 'No extractions found with provided IDs' });
        return;
      }

      // Transform extractions
      extractionsWithSource = (extractions as any[]).map((e) => ({
        id: e.id,
        summary: e.summary,
        key_points: e.key_points,
        topics: e.topics,
        source_material_id: e.source_material_id,
        document_id: e.document_id,
        source_title: e.source_materials?.title ?? e.documents?.title ?? null,
        source_type: e.source_materials?.type ?? (e.document_id ? 'article' : null),
      }));
    }

    // Fetch source assets if IDs provided
    let sourceAssets: SourceAsset[] = [];

    if (body.asset_ids && body.asset_ids.length > 0) {
      const { data: assets, error: assetError } = await db
        .from('assets')
        .select('id, type, title, content')
        .eq('user_id', userId)
        .in('id', body.asset_ids);

      if (assetError) {
        sendJson(res, 500, { success: false, error: 'Failed to fetch source assets' });
        return;
      }

      if (!assets || assets.length === 0) {
        sendJson(res, 404, { success: false, error: 'No assets found with provided IDs' });
        return;
      }

      sourceAssets = assets as SourceAsset[];
      console.log(`[Adhoc] Using ${sourceAssets.length} existing assets as sources`);
    }

    // Log generation mode
    const hasSources = extractionsWithSource.length > 0 || sourceAssets.length > 0;
    if (!hasSources) {
      console.log('[Adhoc] Prompt-only generation (no sources)');
    }

    const results: Asset[] = [];
    const errors: string[] = [];

    // Track source IDs for provenance
    const sourceIds = extractionsWithSource
      .map((e) => e.source_material_id)
      .filter((id): id is string => id !== null);

    const documentIds = extractionsWithSource
      .map((e) => e.document_id)
      .filter((id): id is string => id !== null);

    // Fetch user's content profile
    const profileContext = await getProfileContextForUser(userId);
    if (profileContext) {
      console.log('[Adhoc] Using content profile for generation');
    }

    // Generate all formats in parallel to avoid client timeout
    const generateOne = async (format: string): Promise<void> => {
      console.log(`[Adhoc] Generating ${format}...`);

      const prompt = await getTemplatePrompt(format, userId);
      if (!prompt) {
        errors.push(`${format}: Template not found`);
        return;
      }

      const generated = await generateContent(prompt, extractionsWithSource, sourceAssets, profileContext, body.instructions);

      // Save to assets
      const assetType = mapFormatToAssetType(format);
      if (!assetType) {
        errors.push(`${format}: Unknown asset type mapping`);
        return;
      }

      const insert: AssetInsert = {
        user_id: userId,
        type: assetType,
        title: generated.title,
        content: generated.content,
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
        return;
      }

      // Create provenance links
      if (sourceIds.length > 0) {
        const smInputs: AssetInputInsert[] = sourceIds.map((smId) => ({
          user_id: userId,
          asset_id: asset.id,
          source_material_id: smId,
          document_id: null,
          note: `Generated via adhoc (${format})`,
        }));
        await db.from('asset_inputs').insert(smInputs);
      }

      if (documentIds.length > 0) {
        const docInputs: AssetInputInsert[] = documentIds.map((docId) => ({
          user_id: userId,
          asset_id: asset.id,
          source_material_id: null,
          document_id: docId,
          note: `Generated via adhoc (${format})`,
        }));
        await db.from('asset_inputs').insert(docInputs);
      }

      results.push(asset as Asset);
      console.log(`[Adhoc] Created ${format}: ${asset.id}`);
    };

    await Promise.all(body.formats.map(async (format) => {
      try {
        await generateOne(format);
      } catch (err) {
        errors.push(`${format}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }));

    // Update last_generation_at if we generated any content
    if (results.length > 0) {
      await db
        .from('user_settings')
        .update({ last_generation_at: new Date().toISOString() })
        .eq('user_id', userId);
    }

    sendJson(res, 201, {
      success: true,
      data: {
        generated: results.length,
        extractions_used: extractionsWithSource.length,
        assets_used: sourceAssets.length,
        prompt_only: !hasSources,
        errors: errors.length > 0 ? errors : undefined,
        assets: results,
      },
    });
  } catch (err) {
    console.error('Error in adhoc generation:', err);
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
