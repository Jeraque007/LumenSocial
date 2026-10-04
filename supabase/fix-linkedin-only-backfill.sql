-- ---------------------------------------------------------------------------
-- Recover the posts that were pulled LinkedIn-only during the bug window
-- ---------------------------------------------------------------------------
-- WHERE TO RUN THIS: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- WHY
--   A bug made each MyMarky post import only its first platform (LinkedIn), so Facebook and
--   Instagram rows were never created for those posts. The posts were still recorded in the
--   mymarky_seen ledger, which means they are now correctly treated as "already pulled" and a
--   normal pull will skip them - so the missing platforms will never backfill on their own.
--
--   Clearing the ledger and deleting the broken LinkedIn-only drafts lets one fresh pull recreate
--   those posts correctly, with all three platforms.
--
-- RUN THE CHECKS FIRST, THEN THE FIX. Do not run the fix blindly.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- STEP 1 - Look before you leap. All three queries are read-only.
-- ---------------------------------------------------------------------------

-- 1a. What is in the ledger?
SELECT
  brand,
  COUNT(*) AS posts_remembered,
  MIN(recorded_at) AS first_seen,
  MAX(recorded_at) AS last_seen
FROM mymarky_seen
GROUP BY brand
ORDER BY brand;

-- 1b. Drafts pulled in the last day (the buggy runs happened recently).
SELECT
  brand,
  platform,
  status,
  COUNT(*) AS rows_in_drafts
FROM scheduled_posts
WHERE mymarky_id IS NOT NULL
  AND status = 'draft'
  AND created_at >= NOW() - INTERVAL '1 day'
GROUP BY brand, platform, status
ORDER BY brand, platform;

-- 1c. THE KEY CHECK: a MyMarky source post that exists for LinkedIn but has NO
--     Facebook or Instagram sibling. This is the damage left by the bug.
SELECT
  brand,
  split_part(mymarky_id, '_linkedin', 1) AS source_post_id,
  COUNT(*) AS platforms_present
FROM scheduled_posts
WHERE mymarky_id IS NOT NULL
  AND mymarky_id LIKE '%\_linkedin'
  AND status IN ('draft', 'pending')
GROUP BY brand, split_part(mymarky_id, '_linkedin', 1)
HAVING COUNT(*) = 1
ORDER BY brand
LIMIT 50;

-- If 1c returns nothing, there is no damage to repair - stop here.


-- ---------------------------------------------------------------------------
-- STEP 2 - The fix. Only run this if STEP 1 confirmed broken rows.
-- ---------------------------------------------------------------------------
-- It deletes:
--   1. every draft/pending/failed row that came from MyMarky (the broken LinkedIn-only rows)
--   2. the mymarky_seen ledger, so those posts become pullable again
--
-- It does NOT touch:
--   - published rows (your released history is safe)
--   - manually-created posts where mymarky_id IS NULL
--   - anything in the media library
--
-- After this, go to Autopilot -> Fresh pull -> Pull Week from Mymarky. The affected posts come
-- back with LinkedIn, Facebook AND Instagram.

-- 2a. Delete the broken unpublished MyMarky rows.
DELETE FROM scheduled_posts
WHERE mymarky_id IS NOT NULL
  AND status IN ('draft', 'pending', 'failed');

-- 2b. Clear the already-pulled ledger.
DELETE FROM mymarky_seen;

-- 2c. Confirm both are empty now.
SELECT
  (SELECT COUNT(*) FROM mymarky_seen) AS ledger_rows_should_be_0,
  (SELECT COUNT(*) FROM scheduled_posts
     WHERE mymarky_id IS NOT NULL
       AND status IN ('draft', 'pending', 'failed')) AS drafts_should_be_0;