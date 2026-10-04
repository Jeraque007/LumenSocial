BEGIN;

DELETE FROM scheduled_posts
WHERE platform = 'linkedin'
  AND brand IN ('Tessera Lumen', 'S.A.E Method')
  AND pillar = 'LinkedIn routing test';

INSERT INTO scheduled_posts (
  content,
  media_url,
  platform,
  scheduled_at,
  status,
  brand,
  pillar
) VALUES (
  'TEST - Tessera Lumen LinkedIn personal profile routing. Please delete this post after testing.',
  NULL,
  'linkedin',
  NOW() - INTERVAL '1 minute',
  'pending',
  'Tessera Lumen',
  'LinkedIn routing test'
), (
  'TEST - S.A.E Method LinkedIn company page routing. Please delete this post after testing.',
  NULL,
  'linkedin',
  NOW() - INTERVAL '1 minute',
  'pending',
  'S.A.E Method',
  'LinkedIn routing test'
);

COMMIT;

SELECT
  id,
  platform,
  brand,
  status,
  scheduled_at,
  content
FROM scheduled_posts
WHERE platform = 'linkedin'
  AND pillar = 'LinkedIn routing test'
ORDER BY brand;
