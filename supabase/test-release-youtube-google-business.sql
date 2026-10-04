BEGIN;

DELETE FROM scheduled_posts
WHERE brand = 'TEST'
  AND pillar = 'Release verification';

INSERT INTO scheduled_posts (
  content,
  media_url,
  video_url,
  platform,
  scheduled_at,
  status,
  brand,
  pillar
) VALUES (
  '{"title":"LumenSocial YouTube Test","description":"TEST POST - YouTube release verification. Please delete this video after testing."}',
  NULL,
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'youtube',
  NOW() - INTERVAL '1 minute',
  'pending',
  'TEST',
  'Release verification'
), (
  'TEST POST - Google Business Profile release verification. Please delete this post after testing.',
  NULL,
  NULL,
  'googlebusiness',
  NOW() - INTERVAL '1 minute',
  'pending',
  'TEST',
  'Release verification'
);

COMMIT;

SELECT id, platform, status, scheduled_at, content
FROM scheduled_posts
WHERE brand = 'TEST'
  AND pillar = 'Release verification'
ORDER BY created_at DESC
LIMIT 2;
