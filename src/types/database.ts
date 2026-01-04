/**
 * Database types matching Supabase schema
 */

// ============================================
// ENUMS
// ============================================

export type TrendSourceStatus = 'active' | 'paused' | 'blocked';
export type CrawlMethod = 'rss' | 'sitemap' | 'html' | 'api' | 'manual';
export type SourceMaterialType = 'trend' | 'meeting' | 'voice_note' | 'manual_note';
export type DocumentStatus = 'fetched' | 'parsed' | 'failed' | 'discarded';
export type AssetType = 'newsletter' | 'blog_post' | 'linkedin_post' | 'twitter_post';
export type AssetStatus = 'draft' | 'ready' | 'scheduled' | 'published' | 'archived';

// ============================================
// TABLE TYPES
// ============================================

export interface TrendSource {
  id: string;
  name: string;
  domain: string | null;
  feed_url: string | null;
  sitemap_url: string | null;
  crawl_method: CrawlMethod;
  tier: number;
  status: TrendSourceStatus;
  trust_score: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  trend_source_id: string | null;
  url: string;
  canonical_url: string | null;
  title: string | null;
  author: string | null;
  published_at: string | null;
  fetched_at: string;
  raw_text: string | null;
  dedupe_hash: string | null;
  status: DocumentStatus;
  created_at: string;
}

export interface SourceMaterial {
  id: string;
  type: SourceMaterialType;
  title: string | null;
  content: string;
  source_url: string | null;
  occurred_at: string | null;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  created_at: string;
}

export interface Asset {
  id: string;
  type: AssetType;
  title: string | null;
  content: string;
  status: AssetStatus;
  publish_date: string | null;
  published_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetTag {
  asset_id: string;
  tag_id: string;
}

export interface AssetInput {
  id: string;
  asset_id: string;
  document_id: string | null;
  source_material_id: string | null;
  note: string | null;
  created_at: string;
}

export interface Extraction {
  id: string;
  source_material_id: string | null;
  document_id: string | null;
  summary: string | null;
  key_points: string[] | null;
  topics: string[] | null;
  model: string | null;
  created_at: string;
}

// ============================================
// INSERT TYPES (omit auto-generated fields)
// ============================================

export type TrendSourceInsert = Omit<TrendSource, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DocumentInsert = Omit<Document, 'id' | 'created_at' | 'fetched_at'> & {
  id?: string;
  created_at?: string;
  fetched_at?: string;
};

export type SourceMaterialInsert = Omit<SourceMaterial, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type TagInsert = Omit<Tag, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type AssetInsert = Omit<Asset, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type AssetInputInsert = Omit<AssetInput, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type ExtractionInsert = Omit<Extraction, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};
