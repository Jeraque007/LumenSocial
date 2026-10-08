-- ---------------------------------------------------------------------------
-- test-hoaws-youtube.sql - HOAWS twin of test-youtube.sql (two-channel routing test).
--
-- Proves brand 'HOAWS' uploads with the HOAWS_YOUTUBE_* grant to @HOAWS-963
-- (UCvcko1F9hbSN2cYEJgRnkvQ) and NOT with the S.A.E YOUTUBE_* grant to @sylvana_sae.
-- The connector verifies the token's channel before every upload and refuses a mismatch,
-- so a green result here proves the credentials AND the channel binding.
--
-- 1. Run the whole file. It is safe top to bottom: the DELETE comes BEFORE the INSERT, so
--    there is no trailing cleanup to wipe the row out from under you.
-- 2. Release it straight away - do not wait for the scheduler:
--      Post History -> filter "pending" -> Release Now
--    (The scheduler only fires from the in-app ticker, which needs the app open and you logged
--     in, or from the single Vercel cron at 10:00 SAST.)
-- 3. Run ONLY the SELECT at the bottom - not the whole file, or it resets the row to pending.
--    Expect status = 'published' and error_message IS NULL.
-- 4. Check the @HOAWS-963 channel on YouTube, then delete the test video.
--
-- Requires HOAWS_YOUTUBE_ACCESS_TOKEN + HOAWS_YOUTUBE_REFRESH_TOKEN in Vercel (minted at
-- https://lumensocial.vercel.app/api/auth/google?brand=HOAWS with HOAWS set as the account's
-- Default Channel at youtube.com/advanced, authorizing as the MAIN Gmail - never the
-- hoaws-...@pages.plusgoogle.com identity), GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, YouTube
-- Data API v3 enabled in Google Cloud, and a production deploy that includes the two-channel
-- YouTube work (commits eede82f..bd01ee1).
--
-- NOTE: Vercel only applies new environment variables to NEW deployments - after setting the
-- HOAWS_YOUTUBE_* pair, redeploy before running this test.
--
-- IF IT FAILS
--   "HOAWS_YOUTUBE_ACCESS_TOKEN is expired or unset and HOAWS_YOUTUBE_REFRESH_TOKEN is not set"
--                          -> the env pair is missing, or the deploy predates the two-channel
--                             work. Set both vars and REDeploy.
--   "YouTube channel mismatch ... posts to UC05Ci..." (the S.A.E channel)
--                          -> the HOAWS grant bound to the wrong channel. Re-auth at
--                             /api/auth/google?brand=HOAWS with HOAWS as the Default Channel,
--                             update the env pair, redeploy, re-run this test.
--   "invalid_grant"        -> HOAWS refresh token revoked/expired; re-auth and redeploy.
--   "Service unavailable"  -> that is an AUTH-TIME error (/api/auth/google), never a release
--                             error. If you see it, redo the authorization steps above.
--   status stays 'pending' -> nobody clicked Release Now. Not a YouTube problem.
-- ---------------------------------------------------------------------------

BEGIN;

DELETE FROM scheduled_posts
WHERE brand = 'HOAWS'
  AND pillar = 'HOAWS YouTube routing test';

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
  'LumenSocial HOAWS YouTube routing test - safe to delete after checking. #LumenSocial',
  NULL,
  'https://mdn.github.io/shared-assets/videos/flower.mp4',
  'youtube',
  NOW() - INTERVAL '1 minute',
  'pending',
  'HOAWS',
  'HOAWS YouTube routing test'
);

COMMIT;

-- ---------------------------------------------------------------------------
-- CHECK - run this on its own AFTER releasing. Do not run it as part of the whole file above,
--         or the DELETE resets the row to 'pending' and you start over.
-- ---------------------------------------------------------------------------
SELECT id, platform, brand, status, error_message, published_at, scheduled_at
FROM scheduled_posts
WHERE brand = 'HOAWS'
  AND pillar = 'HOAWS YouTube routing test';