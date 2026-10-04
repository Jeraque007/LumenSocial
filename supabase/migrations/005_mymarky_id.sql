-- Add mymarky_id to track imported posts and prevent duplicates
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS mymarky_id TEXT;
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_mymarky ON scheduled_posts (mymarky_id) WHERE mymarky_id IS NOT NULL;