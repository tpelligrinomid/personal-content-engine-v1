/**
 * Asset Normalizer
 *
 * Transforms raw ingested content into normalized "assets"
 * that can be used for content generation.
 */

// TODO: Define Asset interface (common structure for all content types)
// TODO: Implement normalization logic for each source type
// TODO: Add enrichment hooks (summarization, tagging, etc.)
// TODO: Store normalized assets in database

export interface Asset {
  // TODO: Define asset schema once database contract is finalized
  id?: string;
  sourceType: 'trend' | 'meeting' | 'voice_note';
  rawContent: string;
  // TODO: Add more fields as schema evolves
}

export async function normalizeToAsset(
  sourceType: Asset['sourceType'],
  rawContent: string
): Promise<Asset> {
  // TODO: Implement normalization logic
  throw new Error('Not implemented');
}
