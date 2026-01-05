-- Content Profile Migration
-- Adds personal branding fields to user_settings
-- Run this in your Supabase SQL Editor

-- ============================================
-- Add content profile fields to user_settings
-- ============================================

-- Content pillars - the core topics the user wants to be known for
-- Stored as array of text, e.g., ['Agency M&A', 'Team Building', 'Agency Operations']
ALTER TABLE user_settings ADD COLUMN content_pillars TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Professional background - credentials and experience to reference in content
-- e.g., "Founder of Punctuation, 15 years in agency world, completed multiple acquisitions"
ALTER TABLE user_settings ADD COLUMN professional_background TEXT;

-- Target audience - who the user is writing for
-- e.g., "Agency owners, marketing leaders, entrepreneurs considering exits"
ALTER TABLE user_settings ADD COLUMN target_audience TEXT;

-- Voice and tone - how the user's content should sound
-- e.g., "Direct, practical, occasionally provocative. No fluff."
ALTER TABLE user_settings ADD COLUMN voice_tone TEXT;

-- Unique angle - what makes the user's perspective different
-- e.g., "Practitioner POV - I've been in the trenches, not just advising"
ALTER TABLE user_settings ADD COLUMN unique_angle TEXT;

-- Signature elements - recurring themes, phrases, or frameworks
-- e.g., "The 3-legged stool of agency value; always include actionable takeaway"
ALTER TABLE user_settings ADD COLUMN signature_elements TEXT;

-- ============================================
-- Comments for documentation
-- ============================================

COMMENT ON COLUMN user_settings.content_pillars IS 'Core topics the user wants to be known for (3-6 recommended)';
COMMENT ON COLUMN user_settings.professional_background IS 'Credentials and experience to reference in generated content';
COMMENT ON COLUMN user_settings.target_audience IS 'Description of who the user is writing for';
COMMENT ON COLUMN user_settings.voice_tone IS 'How the content should sound (e.g., direct, conversational, provocative)';
COMMENT ON COLUMN user_settings.unique_angle IS 'What makes this user''s perspective different from others';
COMMENT ON COLUMN user_settings.signature_elements IS 'Recurring themes, phrases, frameworks, or stylistic elements';
