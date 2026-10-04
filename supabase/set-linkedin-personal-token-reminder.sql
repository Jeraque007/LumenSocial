INSERT INTO app_settings (key, value, updated_at)
VALUES (
  'token_reminder_linkedin_personal',
  jsonb_build_object(
    'enabled', true,
    'month', 11,
    'day', 18,
    'emailTo', 'privacy@sae963.com',
    'tokenLabel', 'LinkedIn personal access token for Tessera Lumen',
    'expiresOn', '2026-11-18T17:48:55.350Z',
    'lastSentOn', NULL
  ),
  NOW()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

SELECT key, value, updated_at
FROM app_settings
WHERE key = 'token_reminder_linkedin_personal';
