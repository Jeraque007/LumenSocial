-- Create storage bucket for media uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public read access" ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

-- Allow authenticated uploads (using service role from API)
CREATE POLICY "Service role upload" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'media');

CREATE POLICY "Service role delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'media');