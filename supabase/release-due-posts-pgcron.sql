-- ============================================================================
-- OPTIONAL: release due posts every 5 minutes, server-side (pg_cron + pg_net)
-- ============================================================================
-- Why this exists:
--   vercel.json schedules /api/cron/post-scheduler as "0 8 * * *" (08:00 UTC =
--   10:00 SAST) ONCE per day. On the Vercel Hobby plan that is a hard limit, and
--   the run happens at an arbitrary minute inside the 08:00-08:59 UTC hour. The
--   handler only releases posts that are ALREADY due at that instant, so:
--     * posts approved after the single daily fire wait until the next day, and
--     * posts scheduled later in the day (Tessera 13:00 UTC, HOAWS 16:00 UTC)
--       can never release same-day via the Vercel cron alone.
--   The app itself now runs a 60-second background ticker while a user is logged
--   in (src/components/Layout.tsx) which calls the same endpoint. This SQL job is
--   the EXTRA safety net for when nobody has the app open: Supabase calls the
--   same endpoint every 5 minutes, 24/7.
--
-- Every path claims each post ATOMICALLY before publishing (status pending ->
-- publishing), so the Vercel cron, the in-app ticker, this relay, and manual
-- Release Now can never double-post the same row.
--
-- ---------------------------------------------------------------------------
-- STEP 1 (REQUIRED, do this first or you get: ERROR 3F000 schema "cron" does not exist)
-- ---------------------------------------------------------------------------
-- Enable BOTH extensions from the Dashboard. You CANNOT enable them from the SQL
-- editor: Supabase requires pg_cron to live in pg_catalog, so a plain
--   CREATE EXTENSION pg_cron;                 -- fails
--   CREATE EXTENSION pg_cron WITH SCHEMA extensions;  -- fails ("must be installed
--                                             --  in schema pg_catalog")
-- is rejected. The Dashboard performs the correct, superuser-level install.
--
--   pg_cron:  Dashboard -> Database -> Extensions -> search "pg_cron" -> Enable
--             (or Dashboard -> Integrations -> Cron -> enable the pg_cron extension)
--   pg_net:   Dashboard -> Database -> Extensions -> search "pg_net"  -> Enable
--
-- Neither is enabled on this project yet - that is why `cron.schedule` failed with
-- "schema cron does not exist". Enabling pg_cron creates the `cron` schema.
--
-- Sanity check (run after enabling; both must return a row):
--   SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net');
--
-- ---------------------------------------------------------------------------
-- STEP 2 (REQUIRED): store the secret in Vault (never in plain SQL)
-- ---------------------------------------------------------------------------
-- The job below reads the CRON_SECRET out of Vault at run time, so the secret is
-- not written into the job definition or this file.
--
-- The value MUST equal CRON_SECRET in Vercel Production, EXACTLY - no trailing
-- space, no trailing newline (a stray newline makes the Authorization header
-- invalid and the endpoint replies 401).
--
-- If 'cron_secret' does NOT exist yet, create it:
--   SELECT vault.create_secret(
--     'your_vercel_cron_secret',
--     'cron_secret',
--     'CRON_SECRET for LumenSocial /api/cron/post-scheduler'
--   );
--
-- If it ALREADY exists, create_secret fails with:
--   ERROR 23505: duplicate key value violates unique constraint "secrets_name_idx"
-- In that case UPDATE it instead - note update_secret takes the secret ID first,
-- NOT the name:
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name = 'cron_secret'),
--     'your_vercel_cron_secret'
--   );
--
-- Idempotent version that handles both cases (run this one if unsure):
--   DO $$
--   DECLARE new_secret text := 'your_vercel_cron_secret';
--   BEGIN
--     IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
--       PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'cron_secret'), new_secret);
--     ELSE
--       PERFORM vault.create_secret(new_secret, 'cron_secret', 'CRON_SECRET for LumenSocial /api/cron/post-scheduler');
--     END IF;
--   END $$;
--
-- Verify the stored value matches Vercel (prints the plaintext secret):
--   SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
--
-- ---------------------------------------------------------------------------
-- STEP 3: run the schedule statement at the bottom of this file.
-- ---------------------------------------------------------------------------
-- Adjust the URL if your production domain is not https://lumensocial.vercel.app
--
-- To verify:  SELECT jobid, jobname, schedule, active FROM cron.job;
--             SELECT status_code, content, created
--               FROM net._http_response ORDER BY created DESC LIMIT 5;
--             (A healthy release run returns {"message":"No posts due","processed":0}
--              when nothing is due, or {"processed":N,...} when posts were released.)
--             SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
-- To remove:  SELECT cron.unschedule('lumensocial-release-due-posts');
-- ============================================================================

-- ============================================================================
-- PREFLIGHT: fail with a helpful message instead of
--            ERROR 3F000: schema "cron" does not exist
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron is NOT enabled. Dashboard -> Database -> Extensions -> search "pg_cron" -> Enable, then re-run this file.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_net is NOT enabled. Dashboard -> Database -> Extensions -> search "pg_net" -> Enable, then re-run this file.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_secret') THEN
    RAISE EXCEPTION 'Vault secret cron_secret is missing. Run the vault.create_secret(...) statement from STEP 2 above, then re-run this file.';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: create the job.
-- Re-running this file is safe: cron.schedule OVERWRITES an existing job of the
-- same name, so there is no need to unschedule first.
-- ============================================================================
SELECT cron.schedule(
  'lumensocial-release-due-posts',
  '*/5 * * * *',                    -- every 5 minutes, UTC
  $$
  SELECT net.http_post(
    url     := 'https://lumensocial.vercel.app/api/cron/post-scheduler',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
                 'Content-Type', 'application/json'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
