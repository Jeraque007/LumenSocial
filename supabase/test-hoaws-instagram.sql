-- ============================================================================
-- FINAL HOAWS INSTAGRAM PUBLISH TEST
-- ============================================================================
-- Clears old HOAWS routing-test rows, inserts ONE pending Instagram test post
-- (image — the exact case that used to fail with Meta errors 9007/2207027),
-- then returns its id.
--
-- STEPS:
--  1. Deploy the latest code to Vercel FIRST. The container-readiness polling fix
--     in instagram.ts is not live until you redeploy; without it this test can
--     still fail with 9007/2207027.
--  2. Run this whole script in the Supabase SQL Editor. Copy the returned "id".
--  3. Publish it immediately: Post History → filter "pending" → confirm the
--     release action (uses your stored admin password). Equivalent manual call:
--       curl -X POST https://<your-app>.vercel.app/api/release-now \
--         -H "Authorization: Bearer <ADMIN_PASSWORD>" \
--         -H "Content-Type: application/json" \
--         -d '{"id":"<POST_ID>"}'
--     (Or wait for the daily 08:00 UTC cron / trigger
--       curl -X POST https://<your-app>.vercel.app/api/cron/post-scheduler \
--         -H "Authorization: Bearer <CRON_SECRET>")
--  4. Re-run the CHECK query at the bottom of this file.
--  5. On success: delete the TEST post from the HOAWS Instagram feed.
--     On failure: read error_message — see interpretation table at the bottom.
-- ============================================================================

BEGIN;

-- Remove previous routing-test rows (both platforms) so a stale 'pending' test
-- row cannot be re-published by the next cron run.
DELETE FROM scheduled_posts
WHERE brand = 'HOAWS'
  AND pillar LIKE 'HOAWS%routing test';

INSERT INTO scheduled_posts (
  content,
  media_url,
  platform,
  scheduled_at,
  status,
  brand,
  pillar
) VALUES (
  'TEST - HOAWS Instagram final routing test (image post). Please delete this post after testing.',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=1200&q=80',
  'instagram',
  NOW() - INTERVAL '1 minute',
  'pending',
  'HOAWS',
  'HOAWS Instagram routing test'
);

COMMIT;

-- RESULT 1: copy the "id" value, then release the post (step 3 above)
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
  AND pillar = 'HOAWS Instagram routing test'
ORDER BY scheduled_at DESC;


-- ============================================================================
-- CHECK query — re-run any time AFTER releasing the post
-- ============================================================================
-- EXPECTED OUTCOMES:
--   status='published', error_message=''            → SUCCESS ✅
--       (confirm the image appeared in the HOAWS IG feed, then delete it)
--   status='failed', error mentions 9007/2207027    → readiness fix NOT deployed
--       → redeploy to Vercel, then re-run this whole file
--   status='failed', error mentions 190 /
--     "Cannot parse access token"                   → publishing host rejects the
--       token → check IG_ACCESS_TOKEN_HOAWS / IG_USER_ID_HOAWS in Vercel
--   status='failed', error mentions 401/403         → token expired/revoked →
--       re-authorize the Instagram Graph API
--   status='failed', error mentions 4 or 5xx        → transient Meta API error →
--       re-run this test (release-now already retries 3× with backoff)
-- ============================================================================
-- SELECT
--   id,
--   status,
--   published_at,
--   updated_at,
--   COALESCE(error_message, '') AS error_message
-- FROM scheduled_posts
-- WHERE brand = 'HOAWS'
--   AND pillar = 'HOAWS Instagram routing test'
-- ORDER BY scheduled_at DESC;
