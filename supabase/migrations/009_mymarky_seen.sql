-- ---------------------------------------------------------------------------
-- mymarky_seen: permanent record of every MyMarky post ever pulled.
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
--   Duplicate suppression used to rely on rows in scheduled_posts. That has a fatal flaw:
--   when a scheduled post is DELETED (or purged/reset), its content signature vanishes along
--   with the row, so the very next pull happily re-imports the same material. Deleting a post
--   therefore un-did the "already pulled" protection.
--
--   This table is the durable memory. A row is INSERTED when a post is pulled and is NEVER
--   deleted by the app - not by purge, not by reset, not by deleting the scheduled post itself.
--   Dedupe is checked against this table, so material stays "seen" forever.
--
--   recorded_at is kept for auditing ("when did we first pull this?") and is not used for dedupe.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mymarky_seen (
  id           BIGSERIAL PRIMARY KEY,
  mymarky_id   TEXT NOT NULL,
  brand        TEXT NOT NULL,
  signature    TEXT NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A MyMarky post fans out into one scheduled row per platform, but it is still ONE source post.
  CONSTRAINT mymarky_seen_unique UNIQUE (mymarky_id, brand)
);

-- Dedupe lookups hit this on every pull, one predicate per brand.
CREATE INDEX IF NOT EXISTS idx_mymarky_seen_brand ON mymarky_seen (brand);
-- Content-level dedupe: catches the same caption arriving under a different MyMarky post id,
-- which happens whenever MyMarky regenerates a post rather than editing it in place.
CREATE INDEX IF NOT EXISTS idx_mymarky_seen_signature ON mymarky_seen (brand, signature);


-- ---------------------------------------------------------------------------
-- Optional: clear the ledger to genuinely start over.
-- ---------------------------------------------------------------------------
-- ONLY run this if you WANT previously-pulled material to be importable again. Deleting a
-- scheduled post from the app is enough for day-to-day work and does NOT require this.
--   DELETE FROM mymarky_seen;
-- ---------------------------------------------------------------------------