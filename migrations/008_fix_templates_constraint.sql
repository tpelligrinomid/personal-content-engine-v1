-- Fix templates unique constraint to support per-user overrides
-- The constraint should be on (template_key, user_id) not just template_key

-- Drop the old constraint
ALTER TABLE templates DROP CONSTRAINT IF EXISTS templates_template_key_key;

-- Add the correct composite unique constraint
-- This allows each user to have their own override of each template
ALTER TABLE templates ADD CONSTRAINT templates_user_template_key_unique UNIQUE (user_id, template_key);

-- Note: user_id can be NULL for system defaults, and NULL is treated as distinct in PostgreSQL
-- So system templates (user_id = NULL) won't conflict with user overrides
