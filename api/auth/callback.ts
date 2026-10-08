// OAuth callback handler for Google (YouTube + Google Business)
// This exchanges the authorization code for access + refresh tokens
//
// TWO channels, ONE Google account. `state` (set by /api/auth/google) names the channel this grant
// was meant for, because a Google grant only ever posts to the channel selected during the
// authorization - the YouTube Data API has no way to pick a channel later:
//   no state / state=SAE   -> @sylvana_sae (S.A.E Method) -> save as YOUTUBE_*
//   state=HOAWS            -> @HOAWS-963 (HOAWS)          -> save as HOAWS_YOUTUBE_*
// The page identifies the grant's REAL channel (via channels.list) before any token is copied, so
// a grant can never be saved against the wrong brand.

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const isHoawsGrant = (url.searchParams.get('state') || '').trim().toUpperCase() === 'HOAWS';

  const accessVar = isHoawsGrant ? 'HOAWS_YOUTUBE_ACCESS_TOKEN' : 'YOUTUBE_ACCESS_TOKEN';
  const refreshVar = isHoawsGrant ? 'HOAWS_YOUTUBE_REFRESH_TOKEN' : 'YOUTUBE_REFRESH_TOKEN';
  const brandLabel = isHoawsGrant ? 'HOAWS' : 'S.A.E Method';
  const expectedChannelId = isHoawsGrant ? 'UCvcko1F9hbSN2cYEJgRnkvQ' : 'UC05CiyeaqlzPXFEeAO485OQ';
  const expectedChannelLabel = isHoawsGrant
    ? '@HOAWS-963 (UCvcko1F9hbSN2cYEJgRnkvQ)'
    : '@sylvana_sae (UC05CiyeaqlzPXFEeAO485OQ)';

  if (error) {
    return new Response(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`, {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (!code) {
    return new Response('<html><body><h1>No authorization code received</h1></body></html>', {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Exchange the code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: 'https://lumensocial.vercel.app/api/auth/callback',
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    return new Response(`<html><body><h1>Token Exchange Failed</h1><pre>${err}</pre></body></html>`, {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  const tokens = await tokenResponse.json();

  // Which channel does this grant ACTUALLY post to? Answered before anyone copies the tokens.
  let channelStatus: 'match' | 'mismatch' | 'unknown' = 'unknown';
  let channelDesc = 'could not be determined';
  try {
    const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` },
    });
    if (chRes.ok) {
      const ch = await chRes.json() as {
        items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }>;
      };
      const item = ch.items?.[0];
      if (item?.id) {
        channelDesc = [item.snippet?.title, item.snippet?.customUrl, item.id]
          .filter((part): part is string => Boolean(part))
          .join(' · ');
        channelStatus = item.id === expectedChannelId ? 'match' : 'mismatch';
      } else {
        channelDesc = 'channels.list returned no channel for this grant';
      }
    } else {
      channelDesc = `channels.list returned HTTP ${chRes.status}`;
    }
  } catch {
    channelDesc = 'the YouTube API could not be reached from this page';
  }

  const channelBanner =
    channelStatus === 'match'
      ? `<div style="border:1px solid #16a34a; background:#052e16; padding:1rem; border-radius:8px; margin:1rem 0;">
  <strong style="color:#4ade80;">Correct channel for brand "${brandLabel}"</strong>
  <p style="margin:0.5rem 0 0;">This grant posts to: ${channelDesc}</p>
</div>`
      : channelStatus === 'mismatch'
      ? `<div style="border:1px solid #ef4444; background:#2d0a0a; padding:1rem; border-radius:8px; margin:1rem 0;">
  <strong style="color:#f87171;">WRONG CHANNEL - do NOT save these tokens for brand "${brandLabel}"</strong>
  <p style="margin:0.5rem 0 0;">This grant posts to: ${channelDesc}</p>
  <p style="margin:0.5rem 0 0;">Expected: ${expectedChannelLabel}. Start over at /api/auth/google${isHoawsGrant ? '?brand=HOAWS' : ''} and pick the expected channel in Google's account / brand-account chooser.</p>
</div>`
      : `<div style="border:1px solid #f59e0b; background:#2a1d05; padding:1rem; border-radius:8px; margin:1rem 0;">
  <strong style="color:#fbbf24;">Could not confirm the channel (${channelDesc})</strong>
  <p style="margin:0.5rem 0 0;">The connector re-verifies the channel before every upload and refuses a mismatch, so a wrong token still cannot post to the wrong channel.</p>
</div>`;

  const closingNote = isHoawsGrant
    ? `<p style="color: #f59e0b; margin-top: 2rem;">Save ${accessVar} and ${refreshVar} in Vercel - they carry this grant to HOAWS posts only. The S.A.E YOUTUBE_* pair and GOOGLE_BUSINESS_* stay exactly as they are (do not copy the Google Business values from this visit).</p>`
    : `<p style="color: #f59e0b; margin-top: 2rem;">The YouTube and Google Business connectors can use this same Google OAuth grant. Save the refresh token - it lets both connectors get new access tokens without re-authorizing. If you also need the HOAWS channel, run /api/auth/google?brand=HOAWS in a separate visit.</p>`;

  // Display the tokens (you'll copy these to Vercel env vars)
  return new Response(`<html>
<body style="font-family: monospace; background: #0a0a0a; color: #f5f5f5; padding: 2rem;">
  <h1 style="color: #7c3aed;">Authorization Successful - brand "${brandLabel}"</h1>
  ${channelBanner}
  <p>Copy these values to your Vercel Environment Variables:</p>
  
  <h3>${accessVar}:</h3>
  <textarea style="width:100%; height:80px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>${tokens.access_token}</textarea>
  
  <h3>${refreshVar}:</h3>
  <textarea style="width:100%; height:80px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>${tokens.refresh_token || 'Not provided - you may need to revoke and re-authorize'}</textarea>

  <h3>GOOGLE_BUSINESS_ACCESS_TOKEN:${isHoawsGrant ? ' (do NOT change for a HOAWS grant)' : ''}</h3>
  <textarea style="width:100%; height:80px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>${tokens.access_token}</textarea>

  <h3>GOOGLE_BUSINESS_REFRESH_TOKEN:${isHoawsGrant ? ' (do NOT change for a HOAWS grant)' : ''}</h3>
  <textarea style="width:100%; height:80px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>${tokens.refresh_token || 'Use the same refresh token as YOUTUBE_REFRESH_TOKEN'}</textarea>
  
  <h3>Token expires in:</h3>
  <p>${tokens.expires_in} seconds</p>
  
  ${closingNote}
  <p style="color: #ef4444;">Close this page after copying. Do not share these values.</p>
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html' },
  });
}

export const config = { runtime: 'edge' };
