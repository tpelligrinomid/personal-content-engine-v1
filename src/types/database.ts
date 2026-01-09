/**
 * Database types matching Supabase schema
 */

// ============================================
// ENUMS
// ============================================

export type TrendSourceStatus = 'active' | 'paused' | 'blocked';
export type CrawlMethod = 'rss' | 'sitemap' | 'html' | 'api' | 'manual' | 'reddit' | 'twitter';
export type SourceMaterialType = 'trend' | 'meeting' | 'voice_note' | 'manual_note' | 'podcast';
export type DocumentStatus = 'fetched' | 'parsed' | 'failed' | 'discarded';
export type AssetType = 'newsletter' | 'blog_post' | 'linkedin_post' | 'twitter_post' | 'video_script' | 'podcast_segment';
export type AssetStatus = 'draft' | 'ready' | 'scheduled' | 'published' | 'archived';
export type CrawlSchedule = 'manual' | 'every_6_hours' | 'twice_daily' | 'daily';
export type GenerationSchedule = 'manual' | 'daily' | 'weekly_sunday' | 'weekly_monday';
export type UserRole = 'admin' | 'user';

// ============================================
// TABLE TYPES
// ============================================

export interface UserSettings {
  id: string;
  user_id: string;
  role: UserRole;
  crawl_enabled: boolean;
  crawl_schedule: CrawlSchedule;
  generation_enabled: boolean;
  generation_schedule: GenerationSchedule;
  generation_time: string;
  content_formats: string[];
  timezone: string;
  last_crawl_at: string | null;
  last_generation_at: string | null;
  // Content profile
  content_pillars: string[];
  professional_background: string | null;
  target_audience: string | null;
  voice_tone: string | null;
  unique_angle: string | null;
  signature_elements: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrendSource {
  id: string;
  user_id: string;
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
  user_id: string;
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
  user_id: string;
  type: SourceMaterialType;
  title: string | null;
  content: string;
  source_url: string | null;
  occurred_at: string | null;
  created_at: string;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string;
  is_favorite: boolean;
  created_at: string;
}

export interface Asset {
  id: string;
  user_id: string;
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
  user_id: string;
}

export interface AssetInput {
  id: string;
  user_id: string;
  asset_id: string;
  document_id: string | null;
  source_material_id: string | null;
  note: string | null;
  created_at: string;
}

export interface Extraction {
  id: string;
  user_id: string;
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

export type UserSettingsInsert = Omit<UserSettings, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type UserSettingsUpdate = Partial<Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

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

export interface Template {
  id: string;
  user_id: string | null; // NULL = system default
  template_key: string;
  name: string;
  description: string | null;
  prompt: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type TemplateInsert = Omit<Template, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
