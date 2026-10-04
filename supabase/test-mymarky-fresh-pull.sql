-- ---------------------------------------------------------------------------
-- MyMarky pull checks
-- ---------------------------------------------------------------------------
-- Run these after pulling in Autopilot. Four quick queries, no changes made.
-- ---------------------------------------------------------------------------


-- 1. WHAT JUST GOT PULLED
--    Compare 'imported' per brand against the Autopilot result.
SELECT
  brand,
  platform,
  COUNT(*) AS rows_imported,
  MIN(scheduled_at) AS first_slot,
  MAX(scheduled_at) AS last_slot
FROM scheduled_posts
WHERE mymarky_id IS NOT NULL
  AND created_at >= NOW() - INTERVAL '1 hour'
GROUP BY brand, platform
ORDER BY brand, platform;


-- 2. BRAND PRESENCE - all three should appear
--    If a brand is missing entirely, that brand imported nothing.
SELECT
  brand,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status = 'draft')     AS drafts,
  COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
  COUNT(*) FILTER (WHERE status = 'published') AS published,
  COUNT(*) FILTER (WHERE status = 'failed')    AS failed
FROM scheduled_posts
WHERE mymarky_id IS NOT NULL
GROUP BY brand
ORDER BY brand;


-- 3. DUPLICATE CHECK - must return ZERO rows
--    The same caption scheduled twice for the same platform+brand means dedupe failed.
SELECT
  platform,
  brand,
  left(content, 60) AS content_preview,
  COUNT(*) AS times_scheduled
FROM scheduled_posts
WHERE status IN ('draft', 'pending', 'published', 'failed')
GROUP BY platform, brand, left(content, 60)
HAVING COUNT(*) > 1
ORDER BY times_scheduled DESC;


-- 4. ALREADY-PULLED LEDGER (migration 009)
--    This is the memory that stops deleted material being re-imported.
--    A brand here with zero matching rows means its next pull has nothing to skip.
SELECT
  brand,
  COUNT(*) AS posts_remembered,
  MIN(recorded_at) AS first_seen,
  MAX(recorded_at) AS last_seen
FROM mymarky_seen
GROUP BY brand
ORDER BY brand;


-- ONLY IF YOU WANT ALREADY-PULLED MATERIAL TO BECOME IMPORTABLE AGAIN.
-- Normally leave this alone - it is the thing that stops deleted posts coming back.
--   DELETE FROM mymarky_seen;