-- ---------------------------------------------------------------------------
-- test-youtube.sql - same shape as test-release-youtube-google-business.sql.
--
-- 1. Run the whole file. It is safe top to bottom: the DELETE comes BEFORE the INSERT, so
--    there is no trailing cleanup to wipe the row out from under you.
-- 2. Release it straight away - do not wait for the scheduler:
--      Post History -> filter "pending" -> Release Now
--    (The scheduler only fires from the in-app ticker, which needs the app open and you logged
--     in, or from the single Vercel cron at 10:00 SAST. Waiting on it is what stalled this test.)
-- 3. Run ONLY the SELECT at the bottom - not the whole file, or it resets the row to pending.
--    Expect status = 'published' and error_message IS NULL.
-- 4. Delete the test video from the YouTube channel.
--
-- Requires YOUTUBE_ACCESS_TOKEN, YOUTUBE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
-- (one visit to https://lumensocial.vercel.app/api/auth/google), YouTube Data API v3 enabled in
-- Google Cloud, and a production deploy that includes commit 86396b5.
--
-- IF IT FAILS
--   "Unsupported platform: youtube"   -> the deploy does not include 86396b5 yet.
--   "invalid_grant" / token error     -> re-auth at /api/auth/google and redeploy.
--   "requires a video URL"            -> video_url came back NULL.
--   status stays 'pending'            -> nobody clicked Release Now. Not a YouTube problem.
-- ---------------------------------------------------------------------------

BEGIN;

DELETE FROM scheduled_posts
WHERE brand = 'TEST'
  AND pillar = 'YouTube release verification';

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
  'LumenSocial YouTube connectivity test - safe to delete after checking. #LumenSocial',
  NULL,
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'youtube',
  NOW() - INTERVAL '1 minute',
  'pending',
  'TEST',
  'YouTube release verification'
);

COMMIT;

-- ---------------------------------------------------------------------------
-- CHECK - run this on its own AFTER releasing. Do not run it as part of the whole file above,
--         or the DELETE resets the row to 'pending' and you start over.
-- ---------------------------------------------------------------------------
SELECT id, platform, status, error_message, published_at, scheduled_at
FROM scheduled_posts
WHERE brand = 'TEST'
  AND pillar = 'YouTube release verification';
