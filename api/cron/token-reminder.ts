// Vercel cron endpoint to send an annual Facebook token renewal reminder.
// Runs daily; reminder date + recipient are read from Supabase app_settings.

import { createClient } from '@supabase/supabase-js';

interface TokenReminderConfig {
  enabled?: boolean;
  month?: number;
  day?: number;
  emailTo?: string;
  tokenLabel?: string;
  expiresOn?: string;
  lastSentOn?: string;
  // Optional provider-specific renewal steps. When present they are appended to the reminder email so
  // the recipient gets the exact renewal flow (e.g. the Facebook Page token long-lived exchange).
  renewalSteps?: string[];
}

interface TokenReminderRow {
  key: string;
  value: TokenReminderConfig;
  updated_at?: string;
}

export default async function handler(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_EMAIL_FROM;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!resendApiKey || !from || !supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Missing reminder configuration',
        required_env: ['RESEND_API_KEY', 'REMINDER_EMAIL_FROM', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: settings, error: settingError } = await supabase
    .from('app_settings')
    .select('key, value, updated_at')
    .like('key', 'token_reminder_%');

  if (settingError || !settings?.length) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'No token_reminder_* settings found in app_settings',
        details: settingError?.message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const now = new Date();
  const nowMonth = now.getUTCMonth() + 1;
  const nowDay = now.getUTCDate();
  const today = now.toISOString().slice(0, 10);

  const dueSettings: TokenReminderRow[] = (settings as TokenReminderRow[]).filter(({ value }) => {
    const config = value || {};
    const enabled = config.enabled !== false;
    const month = config.month ?? 10;
    const day = config.day ?? 8;
    return enabled && month === nowMonth && day === nowDay;
  });

  if (dueSettings.length === 0) {
    return new Response(
      JSON.stringify({ success: true, skipped: true, reason: 'date_not_due', today, configured: settings.map(s => ({ key: s.key, month: s.value?.month, day: s.value?.day })) }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  const sent: Array<{ key: string; id: string | null }> = [];
  const errors: Array<{ key: string; error: string }> = [];

  for (const row of dueSettings) {
    const config = row.value || {};
    const to = config.emailTo;
    const tokenLabel = config.tokenLabel || row.key.replace('token_reminder_', '').replace(/_/g, ' ');
    const expiresOn = config.expiresOn || 'unknown date';

    if (!to) {
      errors.push({ key: row.key, error: 'emailTo is not configured in Supabase' });
      continue;
    }

    if (config.lastSentOn === today) {
      sent.push({ key: row.key, id: null });
      continue;
    }

    // Provider-specific steps from Supabase (app_settings.value.renewalSteps) are appended to the
    // generic checklist so the recipient gets the exact renewal flow for that token.
    const steps: string[] = Array.isArray(config.renewalSteps) ? config.renewalSteps : [];
    const stepsText = steps.length > 0 ? '\n\nBrand-specific steps:\n' + steps.map((s) => '- ' + s).join('\n') : '';
    const stepsHtml = steps.length > 0
      ? `<p><strong>Brand-specific steps:</strong></p><ul>${steps.map((s) => `<li>${s}</li>`).join('')}</ul>`
      : '';

    const subject = `LumenSocial reminder: renew ${tokenLabel}`;
    const text = [
      'Reminder from LumenSocial:',
      '',
      `Your ${tokenLabel} is due to expire on ${expiresOn}.`,
      'Please renew the token today to avoid post failures.',
      '',
      'Checklist:',
      '- Generate a fresh access token in the provider dashboard.',
      '- Update the matching environment variable in Vercel.',
      '- Run a one-post publish test.',
    ].join('\n') + stepsText;

    const html = `
      <h2>LumenSocial Token Renewal Reminder</h2>
      <p>Your ${tokenLabel} is due to expire on <strong>${expiresOn}</strong>.</p>
      <p>Please renew the token today to avoid post failures.</p>
      <ul>
        <li>Generate a fresh access token in the provider dashboard.</li>
        <li>Update the matching environment variable in Vercel.</li>
        <li>Run a one-post publish test.</li>
      </ul>
      ${stepsHtml}
    `;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + resendApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      errors.push({ key: row.key, error: err });
      continue;
    }

    const data = await emailRes.json();

    const updatedConfig: TokenReminderConfig = {
      ...config,
      lastSentOn: today,
    };

    await supabase
      .from('app_settings')
      .upsert({ key: row.key, value: updatedConfig, updated_at: new Date().toISOString() });

    sent.push({ key: row.key, id: data?.id || null });
  }

  return new Response(
    JSON.stringify({ success: errors.length === 0, sent, errors: errors.length > 0 ? errors : undefined }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

export const config = { runtime: 'edge' };
