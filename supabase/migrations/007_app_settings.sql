-- Generic app settings table for non-secret runtime configuration.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Default token reminder configuration.
-- Keep secrets (e.g. RESEND_API_KEY) in Vercel env vars.
INSERT INTO app_settings (key, value)
VALUES (
  'token_reminder',
  jsonb_build_object(
    'enabled', true,
    'month', 10,
    'day', 8,
    'emailTo', 'privacy@sae963.com',
    'tokenLabel', 'Facebook page token',
    'expiresOn', '2026-10-10'
  )
)
ON CONFLICT (key) DO NOTHING;
