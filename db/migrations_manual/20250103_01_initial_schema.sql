-- Personal Content Engine: Initial Schema
-- Run this in Supabase SQL Editor
-- Date: 2025-01-03

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE trend_source_status AS ENUM ('active', 'paused', 'blocked');
CREATE TYPE crawl_method AS ENUM ('rss', 'sitemap', 'html', 'api', 'manual');
CREATE TYPE source_material_type AS ENUM ('trend', 'meeting', 'voice_note', 'manual_note');
CREATE TYPE document_status AS ENUM ('fetched', 'parsed', 'failed', 'discarded');
CREATE TYPE asset_type AS ENUM ('newsletter', 'blog_post', 'linkedin_post', 'twitter_post');
CREATE TYPE asset_status AS ENUM ('draft', 'ready', 'scheduled', 'published', 'archived');

-- ============================================
-- TREND SOURCES (registry of publishers/feeds)
-- ============================================

CREATE TABLE trend_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    domain TEXT,
    feed_url TEXT,
    sitemap_url TEXT,
    crawl_method crawl_method NOT NULL DEFAULT 'manual',
    tier INT NOT NULL DEFAULT 2 CHECK (tier BETWEEN 1 AND 3),
    status trend_source_status NOT NULL DEFAULT 'active',
    trust_score NUMERIC(3,2) CHECK (trust_score BETWEEN 0 AND 1),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE trend_sources IS 'Registry of web sources to crawl/monitor. Tier 1 = trusted, Tier 2 = candidate, Tier 3 = blocked.';
COMMENT ON COLUMN trend_sources.tier IS '1 = trusted, 2 = candidate, 3 = blocked';

-- ============================================
-- DOCUMENTS (scraped items from trend sources)
-- ============================================

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trend_source_id UUID REFERENCES trend_sources(id) ON DELETE SET NULL,
    url TEXT NOT NULL,
    canonical_url TEXT,
    title TEXT,
    author TEXT,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_text TEXT,
    dedupe_hash TEXT,
    status document_status NOT NULL DEFAULT 'fetched',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT documents_url_unique UNIQUE (url)
);

CREATE INDEX idx_documents_trend_source ON documents(trend_source_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_published_at ON documents(published_at);
CREATE INDEX idx_documents_dedupe_hash ON documents(dedupe_hash);

COMMENT ON TABLE documents IS 'Scraped articles/pages from trend sources. Dedupe via url or dedupe_hash.';

-- ============================================
-- SOURCE MATERIALS (internal inputs: meetings, voice notes, etc.)
-- ============================================

CREATE TABLE source_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type source_material_type NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    source_url TEXT,
    occurred_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_source_materials_type ON source_materials(type);
CREATE INDEX idx_source_materials_occurred_at ON source_materials(occurred_at);

COMMENT ON TABLE source_materials IS 'Internal inputs: meeting transcripts, voice notes, manual notes, imported trends.';

-- ============================================
-- TAGS (normalized for filtering/reporting)
-- ============================================

CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tags_name_unique UNIQUE (name)
);

COMMENT ON TABLE tags IS 'Normalized tags for assets and future use on sources/documents.';

-- ============================================
-- ASSETS (generated content drafts)
-- ============================================

CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type asset_type NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    status asset_status NOT NULL DEFAULT 'draft',
    publish_date TIMESTAMPTZ,
    published_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assets_type ON assets(type);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_publish_date ON assets(publish_date);

COMMENT ON TABLE assets IS 'Generated content: newsletters, blog posts, social posts.';

-- ============================================
-- ASSET_TAGS (join table)
-- ============================================

CREATE TABLE asset_tags (
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,

    PRIMARY KEY (asset_id, tag_id)
);

COMMENT ON TABLE asset_tags IS 'Many-to-many: assets <-> tags.';

-- ============================================
-- ASSET_INPUTS (provenance: what fed each asset)
-- ============================================

CREATE TABLE asset_inputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    source_material_id UUID REFERENCES source_materials(id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT asset_inputs_has_source CHECK (
        document_id IS NOT NULL OR source_material_id IS NOT NULL
    )
);

CREATE INDEX idx_asset_inputs_asset ON asset_inputs(asset_id);
CREATE INDEX idx_asset_inputs_document ON asset_inputs(document_id);
CREATE INDEX idx_asset_inputs_source_material ON asset_inputs(source_material_id);

COMMENT ON TABLE asset_inputs IS 'Provenance: tracks which documents/source_materials contributed to each asset.';

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trend_sources_updated_at
    BEFORE UPDATE ON trend_sources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER assets_updated_at
    BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
