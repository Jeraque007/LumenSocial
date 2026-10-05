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
-- HOW TO RUN  -  IMPORTANT: RUN ONE BLOCK AT A TIME.
--   Supabase's Run button executes the ENTIRE file when nothing is highlighted. Done that way,
--   STEP 1 inserts the row and STEP 3 immediately deletes it again - so the verdict query that
--   follows comes back with ZERO ROWS. Highlight a single block, then press Ctrl+Enter.
--
--   1. Confirm the Vercel production deploy is live and these four env vars exist:
--        GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
--        YOUTUBE_ACCESS_TOKEN, YOUTUBE_REFRESH_TOKEN
--      Get the tokens in one visit: https://lumensocial.vercel.app/api/auth/google
--      Also confirm "YouTube Data API v3" is ENABLED in Google Cloud Console.
--   2. Highlight STEP 0. Ctrl+Enter. db_allows_youtube must be TRUE.
--   3. Highlight STEP 1. Ctrl+Enter. It must return exactly one row - stop if it does not.
--   4. Make the scheduler run. It has only two triggers:
--        - the in-app ticker in Layout.tsx, every 60s, and ONLY while the app is open AND you
--          are logged in (it reads the admin password from sessionStorage and bails otherwise);
--        - the Vercel cron, vercel.json "0 8 * * *" = 10:00 SAST, ONCE a day. Insert a row at
--          1pm and today's run has already passed - it cannot help until tomorrow.
--      So: open the app logged in and leave it ~60s, or use
--      Post History -> filter "pending" -> Release Now on the test row.
--   5. Highlight STEP 2. Ctrl+Enter. Expect verdict = PASS. It always returns one row.
--   6. Only when finished: uncomment STEP 3, highlight JUST that block, and run it.
--
-- WHAT A FAILURE MEANS
--   status 'failed' + error_message shown in STEP 2   -> read that message; it is the connector's.
--   "Unsupported platform: youtube"                  -> the deploy does not have the fix yet.
--   "YouTube requires a video URL for posting"        -> video_url/media_url was null.
--   "invalid_grant" / "token"                         -> re-auth at /api/auth/google and redeploy.
--   'pending' / verdict "NOT CLAIMED"                 -> the scheduler never ran. NOT a YouTube
--                                                        problem: it ticks every 60s only while the
--                                                        app is open AND you are logged in, plus one
--                                                        Vercel cron at 10:00 SAST. See step 4.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- STEP 0 - Preflight. db_allows_youtube MUST be TRUE or the INSERT in STEP 1 is rejected.
--   The two counts are context only - both being 0 is normal the first time YouTube is ever run.
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
-- STEP 1 - Insert one due YouTube row. HIGHLIGHT THIS WHOLE BLOCK and run it alone.
--   brand 'TEST' keeps it out of the real brands. scheduled_at in the past makes the next
--   scheduler run pick it up. content is PLAIN TEXT on purpose: that is exactly what the MyMarky
--   pull writes, so this exercises the connector's title/description fallback rather than the
--   JSON form used by manually-authored YouTube rows.
--
--   No BEGIN/COMMIT on purpose: a transaction left open by a partial highlight would block the
--   scheduler's UPDATE claim and the row would stay 'pending' forever.
-- ---------------------------------------------------------------------------
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

-- Must return exactly one row. Zero rows means the INSERT was rejected - read the error.
SELECT id, platform, status, scheduled_at, video_url, content
FROM scheduled_posts
WHERE brand = 'TEST'
  AND pillar = 'YouTube release verification';


-- ---------------------------------------------------------------------------
-- STEP 2 - HIGHLIGHT ONLY THIS BLOCK and run it after the scheduler has had a chance to tick.
--   Deliberately built on a LEFT JOIN from a constant so it ALWAYS returns one row. An empty
--   result grid therefore has only one meaning: STEP 1 has not run, or STEP 3 deleted the row.
-- ---------------------------------------------------------------------------
SELECT
  CASE
    WHEN p.id IS NULL
      THEN 'ROW NOT FOUND - run STEP 1 again (or a whole-file Run hit STEP 3 and deleted it).'
    WHEN p.status = 'published'
      THEN 'PASS - YouTube accepted the upload.'
    WHEN p.status = 'failed'
      THEN 'FAIL - read error_message.'
    WHEN p.status = 'publishing'
      THEN 'IN PROGRESS - the connector is uploading right now.'
    ELSE 'NOT CLAIMED - the scheduler has not ticked. Open the app logged in for 60s, or use Release Now.'
  END                                  AS verdict,
  p.id,
  p.status,
  p.error_message,
  p.published_at,
  p.scheduled_at,
  CASE WHEN p.scheduled_at IS NULL THEN NULL
       ELSE NOW() - p.scheduled_at END AS waiting_for
FROM (SELECT 1) AS one
LEFT JOIN scheduled_posts p
  ON p.brand = 'TEST'
 AND p.pillar = 'YouTube release verification';


-- ---------------------------------------------------------------------------
-- STEP 3 - Cleanup. COMMENTED OUT ON PURPOSE, so that Run-with-nothing-highlighted cannot
--          delete the test row before the scheduler has seen it. Uncomment the DELETE,
--          highlight JUST this block, and run it when you are finished. Then delete the video
--          from the YouTube channel.
-- ---------------------------------------------------------------------------
-- DELETE FROM scheduled_posts
-- WHERE brand = 'TEST'
--   AND pillar = 'YouTube release verification';
