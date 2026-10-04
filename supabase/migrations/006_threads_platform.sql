-- Replace snapchat with threads in platform check constraint
ALTER TABLE scheduled_posts DROP CONSTRAINT IF EXISTS scheduled_posts_platform_check;
ALTER TABLE scheduled_posts ADD CONSTRAINT scheduled_posts_platform_check
  CHECK (platform IN ('linkedin', 'facebook', 'instagram', 'tiktok', 'youtube', 'googlebusiness', 'threads'));