BEGIN;

DELETE FROM scheduled_posts
WHERE platform IN ('facebook', 'instagram')
  AND brand = 'HOAWS'
  AND pillar = 'HOAWS routing test';

INSERT INTO scheduled_posts (
  content,
  media_url,
  platform,
  scheduled_at,
  status,
  brand,
  pillar
) VALUES (
  'TEST - HOAWS Facebook Page credential routing. Please delete this post after testing.',
  NULL,
  'facebook',
  NOW() - INTERVAL '1 minute',
  'pending',
  'HOAWS',
  'HOAWS routing test'
), (
  'TEST - HOAWS Instagram credential routing. Please delete this post after testing.',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=1200&q=80',
  'instagram',
  NOW() - INTERVAL '1 minute',
  'pending',
  'HOAWS',
  'HOAWS routing test'
);

COMMIT;

SELECT
  id,
  platform,
  brand,
  status,
  scheduled_at,
  COALESCE(error_message, '') AS error_message,
  content
FROM scheduled_posts
WHERE brand = 'HOAWS'
  AND pillar = 'HOAWS routing test'
ORDER BY platform;
