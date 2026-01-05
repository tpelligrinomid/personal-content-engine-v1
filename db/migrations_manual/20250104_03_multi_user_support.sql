-- Multi-User Support Migration
-- Run this in your Supabase SQL Editor

-- ============================================
-- 1. Create user_settings table
-- ============================================

CREATE TABLE user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Crawl settings
  crawl_enabled BOOLEAN DEFAULT true,
  crawl_schedule VARCHAR(50) DEFAULT 'daily', -- 'manual', 'every_6_hours', 'twice_daily', 'daily'

  -- Generation settings
  generation_enabled BOOLEAN DEFAULT true,
  generation_schedule VARCHAR(50) DEFAULT 'weekly_sunday', -- 'manual', 'daily', 'weekly_sunday', 'weekly_monday'
  generation_time TIME DEFAULT '08:00',

  -- Content package - which formats to generate
  content_formats TEXT[] DEFAULT ARRAY['linkedin_post'],

  -- Timezone for scheduling
  timezone VARCHAR(50) DEFAULT 'America/New_York',

  -- Timestamps
  last_crawl_at TIMESTAMPTZ,
  last_generation_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for scheduler lookups
CREATE INDEX idx_user_settings_crawl ON user_settings(crawl_enabled, crawl_schedule);
CREATE INDEX idx_user_settings_generation ON user_settings(generation_enabled, generation_schedule);

-- ============================================
-- 2. Add user_id to existing tables
-- ============================================

-- trend_sources
ALTER TABLE trend_sources ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_trend_sources_user ON trend_sources(user_id);

-- documents
ALTER TABLE documents ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_documents_user ON documents(user_id);

-- source_materials
ALTER TABLE source_materials ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_source_materials_user ON source_materials(user_id);

-- extractions
ALTER TABLE extractions ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_extractions_user ON extractions(user_id);

-- assets
ALTER TABLE assets ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_assets_user ON assets(user_id);

-- asset_inputs
ALTER TABLE asset_inputs ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_asset_inputs_user ON asset_inputs(user_id);

-- templates (user overrides - NULL user_id means system default)
ALTER TABLE templates ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_templates_user ON templates(user_id);

-- ============================================
-- 3. Row Level Security (RLS) Policies
-- ============================================

-- Enable RLS on all tables
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE trend_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- Policies for user_settings
CREATE POLICY "Users can view own settings" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policies for trend_sources
CREATE POLICY "Users can view own trend_sources" ON trend_sources
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own trend_sources" ON trend_sources
  FOR ALL USING (auth.uid() = user_id);

-- Policies for documents
CREATE POLICY "Users can view own documents" ON documents
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own documents" ON documents
  FOR ALL USING (auth.uid() = user_id);

-- Policies for source_materials
CREATE POLICY "Users can view own source_materials" ON source_materials
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own source_materials" ON source_materials
  FOR ALL USING (auth.uid() = user_id);

-- Policies for extractions
CREATE POLICY "Users can view own extractions" ON extractions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own extractions" ON extractions
  FOR ALL USING (auth.uid() = user_id);

-- Policies for assets
CREATE POLICY "Users can view own assets" ON assets
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own assets" ON assets
  FOR ALL USING (auth.uid() = user_id);

-- Policies for asset_inputs
CREATE POLICY "Users can view own asset_inputs" ON asset_inputs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own asset_inputs" ON asset_inputs
  FOR ALL USING (auth.uid() = user_id);

-- Policies for templates (users can see system defaults + their own)
CREATE POLICY "Users can view system and own templates" ON templates
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);
CREATE POLICY "Users can manage own templates" ON templates
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 4. Service role bypass for backend
-- ============================================
-- Note: The backend uses service_role key which bypasses RLS
-- This is intentional - the backend handles auth via JWT validation

-- ============================================
-- 5. Auto-create user_settings on signup
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 6. Updated_at trigger for user_settings
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
