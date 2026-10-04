-- Routing test for the DEFAULT (S.A.E Method) Facebook Page + Instagram account.
-- Uses no HOAWS_* variables, so a pass here proves FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN
-- and INSTAGRAM_BUSINESS_ACCOUNT_ID / INSTAGRAM_ACCESS_TOKEN are wired to S.A.E Method.
BEGIN;

DELETE FROM scheduled_posts
WHERE platform IN ('facebook', 'instagram')
  AND brand = 'S.A.E Method'
  AND pillar = 'S.A.E routing test';

INSERT INTO scheduled_posts (
  content,
  media_url,
  platform,
  scheduled_at,
  status,
  brand,
  pillar
) VALUES (
  'TEST - S.A.E Method Facebook Page credential routing. Please delete this post after testing.',
  NULL,
  'facebook',
  NOW() - INTERVAL '1 minute',
  'pending',
  'S.A.E Method',
  'S.A.E routing test'
), (
  'TEST - S.A.E Method Instagram credential routing. Please delete this post after testing.',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=1200&q=80',
  'instagram',
  NOW() - INTERVAL '1 minute',
  'pending',
  'S.A.E Method',
  'S.A.E routing test'
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
WHERE brand = 'S.A.E Method'
  AND pillar = 'S.A.E routing test'
ORDER BY platform;
