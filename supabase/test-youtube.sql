-- ---------------------------------------------------------------------------
-- test-youtube.sql - prove the YouTube path end to end before trusting it.
--
-- WHY THIS FILE EXISTS
--   YouTube was never wired into LumenSocial. api/pull-mymarky.ts, api/cron/post-scheduler.ts,
--   api/release-now.ts and src/lib/connectors/index.ts all declared
--   type Platform = 'linkedin' | 'facebook' | 'instagram', so a youtube row - if one had ever
--   existed - would have published as "Unsupported platform: youtube". Those four now accept
--   'youtube'. This test proves the remaining link: that a due youtube row actually reaches the
--   connector and uploads.
--
-- HOW TO RUN
--   1. Confirm the Vercel env vars are set and the deploy is live:
--        GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
--        YOUTUBE_ACCESS_TOKEN, YOUTUBE_REFRESH_TOKEN
--      Get them via  https://lumensocial.vercel.app/api/auth/google
--      Also confirm in Google Cloud Console that "YouTube Data API v3" is ENABLED on the project.
--   2. Run STEP 1 in the Supabase SQL Editor.
--   3. Wait ~60 seconds for the scheduler tick (or click "Release now" on the row in the app).
--   4. Run STEP 2. Expect status = 'published'.
--   5. Run STEP 3 to clean up, then delete the video from the YouTube channel.
--
-- WHAT A FAILURE MEANS
--   status 'failed' + error_message shown in STEP 2   -> read that message; it is the connector's.
--   "Unsupported platform: youtube"                  -> the deploy does not have the fix yet.
--   "YouTube requires a video URL for posting"        -> video_url/media_url was null.
--   "invalid_grant" / "token"                         -> re-auth at /api/auth/google and redeploy.
--   Stuck at 'pending'                                -> the cron did not tick; the scheduler
--                                                        ticker normally releases within a minute.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- STEP 0 - Preflight. Run this first; both rows must come back TRUE.
-- ---------------------------------------------------------------------------
SELECT
  -- The DB must allow the platform at all (migration 006 added it to the check constraint).
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduled_posts_platform_check'
      AND pg_get_constraintdef(oid) ILIKE '%youtube%'
  )                                              AS db_allows_youtube,
  -- And no youtube row has ever silently failed before today.
  (SELECT COUNT(*) FROM scheduled_posts
    WHERE platform = 'youtube')                  AS youtube_rows_ever,
  (SELECT COUNT(*) FROM scheduled_posts
    WHERE platform = 'youtube'
    AND status = 'failed')                       AS youtube_rows_failed;


-- ---------------------------------------------------------------------------
-- STEP 1 - Insert one due YouTube row.
--   brand 'TEST' keeps it out of the real brands. scheduled_at in the past makes the very next
--   scheduler run pick it up. content is PLAIN TEXT on purpose: that is exactly what the MyMarky
--   pull writes, so this exercises the connector's title/description fallback rather than the
--   JSON form used by manually-authored YouTube rows.
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

SELECT id, platform, status, scheduled_at, video_url, content
FROM scheduled_posts
WHERE brand = 'TEST'
  AND pillar = 'YouTube release verification';


-- ---------------------------------------------------------------------------
-- STEP 2 - Run ~60 seconds after STEP 1.
--   EXPECT: status = 'published', error_message IS NULL.
--   Anything else: error_message holds the exact reason from the connector.
-- ---------------------------------------------------------------------------
SELECT
  status,
  error_message,
  published_at,
  CASE
    WHEN status = 'published'  THEN 'PASS - YouTube accepted the upload.'
    WHEN status = 'failed'     THEN 'FAIL - read error_message.'
    ELSE 'NOT FINISHED - scheduler has not picked it up yet. Wait, or use Release now.'
  END AS verdict
FROM scheduled_posts
WHERE brand = 'TEST'
  AND pillar = 'YouTube release verification';


-- ---------------------------------------------------------------------------
-- STEP 3 - Cleanup. Safe to run at any time.
-- ---------------------------------------------------------------------------
DELETE FROM scheduled_posts
WHERE brand = 'TEST'
  AND pillar = 'YouTube release verification';
