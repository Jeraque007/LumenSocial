-- Add multi-image and video support to scheduled_posts
-- media_urls: JSON array of image URLs (up to 3 per platform)
-- video_url: dedicated video URL field (separate from media_url for clarity)

ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS media_urls TEXT;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS video_url TEXT;

-- Drop the old generated_images and generated_videos tables
-- These are no longer needed as media generation is now inline in the autopilot flow
DROP TABLE IF EXISTS generated_images;
DROP TABLE IF EXISTS generated_videos;