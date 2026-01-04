-- Add extractions table for storing LLM-extracted summaries and key points
-- Run this in Supabase SQL Editor
-- Date: 2025-01-04

-- ============================================
-- EXTRACTIONS TABLE
-- ============================================

CREATE TABLE extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_material_id UUID REFERENCES source_materials(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    summary TEXT,
    key_points TEXT[],
    topics TEXT[],
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT extractions_has_source CHECK (
        source_material_id IS NOT NULL OR document_id IS NOT NULL
    )
);

CREATE INDEX idx_extractions_source_material ON extractions(source_material_id);
CREATE INDEX idx_extractions_document ON extractions(document_id);

COMMENT ON TABLE extractions IS 'LLM-extracted summaries and key points from source materials and documents.';
COMMENT ON COLUMN extractions.model IS 'The model used for extraction (e.g., claude-sonnet-4-20250514)';
