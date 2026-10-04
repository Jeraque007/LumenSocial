-- Media library table for user-generated images and videos
CREATE TABLE IF NOT EXISTS media_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('image', 'video')),
  url TEXT NOT NULL,
  prompt TEXT,
  brand TEXT,
  model TEXT,
  width INTEGER,
  height INTEGER,
  duration INTEGER,
  aspect_ratio TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_media_library_type ON media_library (type, created_at DESC);