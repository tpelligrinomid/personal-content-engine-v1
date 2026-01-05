-- Add User Roles Migration
-- Run this in your Supabase SQL Editor AFTER the multi-user migration

-- ============================================
-- 1. Add role column to user_settings
-- ============================================

ALTER TABLE user_settings
ADD COLUMN role VARCHAR(20) DEFAULT 'user' NOT NULL;

-- Valid roles: 'admin', 'user'
-- Admin can: invite users, manage all users, view usage
-- User can: manage their own content and settings

-- Add index for role lookups
CREATE INDEX idx_user_settings_role ON user_settings(role);

-- ============================================
-- 2. Update the auto-create trigger to include role
-- ============================================

-- Drop and recreate the trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_settings (user_id, role)
  VALUES (NEW.id, 'user');  -- Default to 'user' role
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. Admin-only RLS policies
-- ============================================

-- Function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_settings
    WHERE user_id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admins can view all user settings
CREATE POLICY "Admins can view all user settings" ON user_settings
  FOR SELECT USING (is_admin() OR auth.uid() = user_id);

-- Only admins can update roles (but users can update their own non-role settings)
-- Note: The backend enforces role update restrictions via code

-- ============================================
-- 4. Set yourself as admin (run this once)
-- ============================================

-- Replace 'YOUR_USER_ID' with your actual Supabase user ID
-- You can find it in Supabase Dashboard > Authentication > Users

-- UPDATE user_settings SET role = 'admin' WHERE user_id = 'YOUR_USER_ID';

-- Or if you're the first user:
-- UPDATE user_settings SET role = 'admin' WHERE created_at = (SELECT MIN(created_at) FROM user_settings);
