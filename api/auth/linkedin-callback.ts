// LinkedIn OAuth callback handler
// Exchanges the authorization code for access + refresh tokens

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  if (error) {
    return new Response(
      '<html><body style="font-family:monospace;background:#0a0a0a;color:#f5f5f5;padding:2rem;">' +
      '<h1 style="color:#ef4444;">Authorization Failed</h1>' +
      '<p>' + error + ': ' + (errorDesc || '') + '</p>' +
      '</body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  if (!code) {
    return new Response(
      '<html><body><h1>No authorization code received</h1></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://lumensocial.vercel.app/api/auth/linkedin-callback',
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    return new Response(
      '<html><body style="font-family:monospace;background:#0a0a0a;color:#f5f5f5;padding:2rem;">' +
      '<h1 style="color:#ef4444;">Token Exchange Failed</h1><pre>' + err + '</pre>' +
      '</body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  const tokens = await tokenResponse.json();

  // Fetch the member profile to get the author URN
  const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { 'Authorization': 'Bearer ' + tokens.access_token },
  });
  const profile = profileResponse.ok ? await profileResponse.json() : null;
  const personId = profile?.sub || 'unknown';
  const authorUrn = 'urn:li:person:' + personId;

  const expiresAt = new Date(Date.now() + (tokens.expires_in || 5184000) * 1000).toISOString();

  const html = '<html>' +
    '<body style="font-family: monospace; background: #0a0a0a; color: #f5f5f5; padding: 2rem;">' +
    '<h1 style="color: #7c3aed;">LinkedIn Authorization Successful</h1>' +
    '<p>Copy these values to your Vercel Environment Variables then redeploy:</p>' +
    '<h3>LINKEDIN_ACCESS_TOKEN:</h3>' +
    '<textarea style="width:100%; height:80px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>' + tokens.access_token + '</textarea>' +
    '<h3>LINKEDIN_REFRESH_TOKEN:</h3>' +
    '<textarea style="width:100%; height:80px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>' + (tokens.refresh_token || 'Not returned - offline_access scope may not be enabled for your app') + '</textarea>' +
    '<h3>LINKEDIN_AUTHOR_URN:</h3>' +
    '<textarea style="width:100%; height:60px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>' + authorUrn + '</textarea>' +
    '<h3>Token expires:</h3>' +
    '<p>' + expiresAt + ' (access token valid ~60 days; refresh token valid ~1 year)</p>' +
    '<p style="color:#f59e0b; margin-top:1.5rem;">Save LINKEDIN_REFRESH_TOKEN - it allows automatic renewal without re-authorizing.</p>' +
    '<p style="color:#ef4444;">Close this page after copying. Never share these tokens.</p>' +
    '</body></html>';

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

export const config = { runtime: 'edge' };