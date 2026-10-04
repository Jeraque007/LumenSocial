-- ---------------------------------------------------------------------------
-- S.A.E Method Facebook Page token - expiry reminder (email to privacy@sae963.com)
-- ---------------------------------------------------------------------------
-- Token expiry being tracked : 2026-11-25 (S.A.E Method Facebook Page access token)
-- Reminder email sent on     : 2026-11-24, i.e. exactly ONE DAY BEFORE expiry.
-- Recipient                  : privacy@sae963.com
--
-- Companion reminder for the HOAWS Page lives in
--   supabase/set-hoaws-facebook-token-reminder.sql  (key: token_reminder_facebook_hoaws)
-- Both brands are renewed in ONE visit: /api/auth/facebook-token?user_token=... mints durable Page
-- tokens for S.A.E Method AND HOAWS and derives them from a 60-day long-lived User token, so the
-- Page tokens no longer expire. The dates are intentionally aligned so a single renewal trip
-- satisfies both reminders.
--
-- How it works (existing LumenSocial reminder pattern - no other change needed):
--   1. This file stores the reminder in app_settings under the key
--      'token_reminder_facebook_sae'.
--   2. The Vercel cron /api/cron/token-reminder runs daily at 08:00 UTC
--      (see vercel.json) and loads every app_settings row whose key is
--      LIKE 'token_reminder_%'.
--   3. On the day whose month/day match that row it emails emailTo through
--      Resend and stamps lastSentOn, so it sends at most once per day.
--
-- Required Vercel (Production) env vars for the cron:
--   CRON_SECRET, RESEND_API_KEY, REMINDER_EMAIL_FROM, SUPABASE_URL,
--   SUPABASE_SERVICE_ROLE_KEY
--
-- Re-run this whole file after every renewal with the new expiry date: month/day
-- are DERIVED from expiresOn below, so the reminder always lands exactly one day
-- before the token dies and can never drift out of sync with the expiry date.
-- ---------------------------------------------------------------------------

WITH reminder_date AS (
  SELECT (DATE '2026-11-25' - INTERVAL '1 day')::DATE AS remind_on
)
INSERT INTO app_settings (key, value, updated_at)
SELECT
  'token_reminder_facebook_sae',
  jsonb_build_object(
    'enabled',    true,
    'month',      EXTRACT(MONTH FROM remind_on)::INT,   -- 11
    'day',        EXTRACT(DAY   FROM remind_on)::INT,   -- 24 (one day before expiry)
    'emailTo',    'privacy@sae963.com',
    'tokenLabel', 'S.A.E Method Facebook Page access token',
    'expiresOn',  '2026-11-25',
    'lastSentOn', NULL,                                  -- reset so the next run can send
    'provider',   'facebook',
    'brand',      'S.A.E Method',
    'envVar',     'FACEBOOK_PAGE_ACCESS_TOKEN',
    'pageId',     '182681844923872',
    'renewalSteps', jsonb_build_array(
      'Open /api/auth/facebook-token?user_token=YOUR_USER_TOKEN (a short-lived Graph API Explorer token is fine) - one visit mints durable Page tokens for BOTH S.A.E Method and HOAWS, so renewing S.A.E can no longer break HOAWS.',
      'Copy the Page ID, Page token and long-lived User token shown for EACH brand into Vercel Production and redeploy.',
      'Verify each token with GET /debug_token?input_token=NEW_PAGE_TOKEN&access_token=1358945715605007|APP_SECRET - Type must be Page and Expires must be "Never".',
      'Publish a test post with supabase/test-sae-facebook-instagram.sql, then re-run supabase/set-sae-facebook-token-reminder.sql with the new expiry date.'
    )
  ),
  NOW()
FROM reminder_date
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- Verification: recipient, the date the email fires, the expiry it refers to and
-- how many days away that is right now.
SELECT
  key,
  value->>'emailTo'    AS email_to,
  value->>'tokenLabel' AS token_label,
  value->>'expiresOn'  AS expires_on,
  make_date(
    EXTRACT(YEAR FROM (value->>'expiresOn')::DATE)::INT,
    (value->>'month')::INT,
    (value->>'day')::INT
  ) AS reminder_fires_on,
  (value->>'expiresOn')::DATE - CURRENT_DATE AS days_until_expiry,
  value->>'envVar'     AS env_var,
  value->>'pageId'     AS page_id,
  value->>'lastSentOn' AS last_sent_on,
  COALESCE((value->>'enabled')::BOOLEAN, TRUE) AS enabled
FROM app_settings
WHERE key = 'token_reminder_facebook_sae';

-- ---------------------------------------------------------------------------
-- Test it now (optional) - do not wait until 24 November
-- ---------------------------------------------------------------------------
-- 1. Temporarily move this reminder to today (UTC):
--
-- UPDATE app_settings
-- SET value = jsonb_set(
--               jsonb_set(value, '{month}', to_jsonb(EXTRACT(MONTH FROM CURRENT_DATE)::INT)),
--               '{day}',                    to_jsonb(EXTRACT(DAY   FROM CURRENT_DATE)::INT)
--             ),
--     updated_at = NOW()
-- WHERE key = 'token_reminder_facebook_sae';
--
-- 2. Trigger the cron by hand (returns JSON with sent/errors):
--
-- curl -X POST https://<your-app>/api/cron/token-reminder -H "Authorization: Bearer <CRON_SECRET>"
--
-- 3. Re-run the INSERT part of this file to restore the real 24 November date
--    (it also clears lastSentOn).
--
-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
-- * The cron compares only month + day, so the reminder repeats every 24 November.
--   After a renewal, re-run this file with the new expiry date so the date stays correct.
-- * One recipient per row: the cron sends to a single emailTo address. For extra
--   recipients, add another row (e.g. 'token_reminder_facebook_sae_cc') with the same
--   month/day but the other emailTo.
-- * After the token is replaced, the new expiry comes from
--   GET /debug_token?input_token=NEW_PAGE_TOKEN&access_token=1358945715605007|APP_SECRET
--   (the "expires_at" value; 0 means it never expires, which is the normal case now that
--   /api/auth/facebook-token derives Page tokens from a long-lived User token).
-- * To pause the reminder: UPDATE app_settings SET value = jsonb_set(value, '{enabled}', 'false')
--   WHERE key = 'token_reminder_facebook_sae';
--
-- ---------------------------------------------------------------------------
-- OPTIONAL alternative: let Supabase send the email itself (pg_cron + pg_net)
-- ---------------------------------------------------------------------------
-- Only use this if you do NOT want the Vercel cron to send it. It needs the pg_cron
-- and pg_net extensions plus the Resend key stored in Vault (never in plain SQL).
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;
-- SELECT vault.create_secret('re_your_resend_api_key', 'resend_api_key', 'Resend key for LumenSocial reminders');
--
-- SELECT cron.schedule(
--   'sae-facebook-token-reminder',
--   '0 8 24 11 *',                    -- 08:00 UTC on 24 November, every year
--   $$
--   SELECT net.http_post(
--     url     := 'https://api.resend.com/emails',
--     headers := jsonb_build_object(
--                  'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'resend_api_key'),
--                  'Content-Type', 'application/json'
--                ),
--     body    := jsonb_build_object(
--                  'from',    'LumenSocial <reminders@your-verified-domain>',
--                  'to',      jsonb_build_array('privacy@sae963.com'),
--                  'subject', 'LumenSocial reminder: renew S.A.E Method Facebook Page access token',
--                  'text',    'The S.A.E Method Facebook Page access token expires on 2026-11-25. Generate fresh Page tokens for BOTH brands via /api/auth/facebook-token and update FACEBOOK_PAGE_ACCESS_TOKEN (and HOAWS_FACEBOOK_PAGE_ACCESS_TOKEN) in Vercel.'
--                )
--   );
--   $$
-- );
--
-- Check the queue/results:  SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;
-- Remove the job:           SELECT cron.unschedule('sae-facebook-token-reminder');