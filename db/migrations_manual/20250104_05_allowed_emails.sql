-- Migration: Add email allowlist for invite-only access
-- Run this in Supabase SQL Editor

-- Create allowed_emails table
CREATE TABLE IF NOT EXISTS allowed_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  added_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast email lookups
CREATE INDEX idx_allowed_emails_email ON allowed_emails(email);

-- Enable RLS
ALTER TABLE allowed_emails ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage allowed emails
CREATE POLICY "Admins can view allowed emails"
  ON allowed_emails FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_settings
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can insert allowed emails"
  ON allowed_emails FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_settings
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can delete allowed emails"
  ON allowed_emails FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_settings
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Service role bypasses RLS for backend checks
-- No additional policy needed

-- Add your initial allowed emails here:
-- INSERT INTO allowed_emails (email) VALUES ('you@gmail.com');
-- INSERT INTO allowed_emails (email) VALUES ('friend@gmail.com');
