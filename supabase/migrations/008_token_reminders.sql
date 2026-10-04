-- Multiple reminder records so each token can be tracked independently.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value)
VALUES
  (
    'token_reminder_facebook',
    jsonb_build_object(
      'enabled', true,
      'month', 10,
      'day', 8,
      'emailTo', 'privacy@sae963.com',
      'tokenLabel', 'Facebook page token',
      'expiresOn', '2026-10-10',
      'lastSentOn', NULL
    )
  ),
  (
    'token_reminder_linkedin',
    jsonb_build_object(
      'enabled', true,
      'month', 10,
      'day', 11,
      'emailTo', 'privacy@sae963.com',
      'tokenLabel', 'LinkedIn access token',
      'expiresOn', '2026-10-11',
      'lastSentOn', NULL
    )
  ),
  (
    'token_reminder_instagram',
    jsonb_build_object(
      'enabled', true,
      'month', 10,
      'day', 11,
      'emailTo', 'privacy@sae963.com',
      'tokenLabel', 'Instagram access token',
      'expiresOn', '2026-10-11',
      'lastSentOn', NULL
    )
  )
ON CONFLICT (key) DO NOTHING;
