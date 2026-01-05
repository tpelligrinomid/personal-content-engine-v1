-- Archive Support Migration
-- Adds archived_at column to source_materials, documents, and extractions
-- Run this in your Supabase SQL Editor

-- ============================================
-- Add archived_at to source_materials
-- ============================================

ALTER TABLE source_materials ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient filtering
CREATE INDEX idx_source_materials_archived ON source_materials(archived_at) WHERE archived_at IS NULL;

COMMENT ON COLUMN source_materials.archived_at IS 'When this item was archived. NULL = active, non-NULL = archived';

-- ============================================
-- Add archived_at to documents
-- ============================================

ALTER TABLE documents ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient filtering
CREATE INDEX idx_documents_archived ON documents(archived_at) WHERE archived_at IS NULL;

COMMENT ON COLUMN documents.archived_at IS 'When this item was archived. NULL = active, non-NULL = archived';

-- ============================================
-- Add archived_at to extractions
-- ============================================

ALTER TABLE extractions ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient filtering
CREATE INDEX idx_extractions_archived ON extractions(archived_at) WHERE archived_at IS NULL;

COMMENT ON COLUMN extractions.archived_at IS 'When this item was archived. NULL = active, non-NULL = archived';

-- ============================================
-- Helper function to cascade archive to extractions
-- ============================================

-- When a source_material is archived, optionally archive its extractions
CREATE OR REPLACE FUNCTION cascade_archive_source_material()
RETURNS TRIGGER AS $$
BEGIN
  -- Only cascade if being archived (was NULL, now has value)
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    UPDATE extractions
    SET archived_at = NEW.archived_at
    WHERE source_material_id = NEW.id
      AND archived_at IS NULL;
  END IF;

  -- If being unarchived, also unarchive related extractions
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
    UPDATE extractions
    SET archived_at = NULL
    WHERE source_material_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_source_material_archive
  AFTER UPDATE OF archived_at ON source_materials
  FOR EACH ROW EXECUTE FUNCTION cascade_archive_source_material();

-- When a document is archived, optionally archive its extractions
CREATE OR REPLACE FUNCTION cascade_archive_document()
RETURNS TRIGGER AS $$
BEGIN
  -- Only cascade if being archived (was NULL, now has value)
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    UPDATE extractions
    SET archived_at = NEW.archived_at
    WHERE document_id = NEW.id
      AND archived_at IS NULL;
  END IF;

  -- If being unarchived, also unarchive related extractions
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
    UPDATE extractions
    SET archived_at = NULL
    WHERE document_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_document_archive
  AFTER UPDATE OF archived_at ON documents
  FOR EACH ROW EXECUTE FUNCTION cascade_archive_document();
