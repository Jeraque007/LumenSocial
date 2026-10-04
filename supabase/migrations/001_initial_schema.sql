-- Scheduled Posts table (supports draft/approval workflow)
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  media_url TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'facebook', 'instagram', 'tiktok', 'youtube', 'googlebusiness', 'snapchat')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'publishing', 'published', 'failed', 'rejected')),
  error_message TEXT,
  published_at TIMESTAMPTZ,
  brand TEXT, -- 'S.A.E Method' or 'Tessera Lumen'
  pillar TEXT, -- content pillar name
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for the cron job to find due posts
CREATE INDEX idx_scheduled_posts_due ON scheduled_posts (scheduled_at)
  WHERE status = 'pending';

-- Index for the approval queue
CREATE INDEX idx_scheduled_posts_drafts ON scheduled_posts (created_at DESC)
  WHERE status = 'draft';

-- Generated Images table
CREATE TABLE IF NOT EXISTS generated_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt TEXT NOT NULL,
  image_url TEXT NOT NULL,
  storage_path TEXT,
  width INTEGER DEFAULT 1024,
  height INTEGER DEFAULT 1024,
  model TEXT DEFAULT 'flux',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Generated Videos table
CREATE TABLE IF NOT EXISTS generated_videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt TEXT NOT NULL,
  video_url TEXT NOT NULL,
  storage_path TEXT,
  duration INTEGER DEFAULT 4,
  aspect_ratio TEXT DEFAULT '16:9',
  model TEXT DEFAULT 'wan-fast',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
