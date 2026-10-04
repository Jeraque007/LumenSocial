// OAuth callback handler for Google (YouTube + Google Business)
// This exchanges the authorization code for access + refresh tokens

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

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

  // Display the tokens (you'll copy these to Vercel env vars)
  return new Response(`<html>
<body style="font-family: monospace; background: #0a0a0a; color: #f5f5f5; padding: 2rem;">
  <h1 style="color: #7c3aed;">Authorization Successful</h1>
  <p>Copy these values to your Vercel Environment Variables:</p>
  
  <h3>YOUTUBE_ACCESS_TOKEN:</h3>
  <textarea style="width:100%; height:80px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>${tokens.access_token}</textarea>
  
  <h3>YOUTUBE_REFRESH_TOKEN:</h3>
  <textarea style="width:100%; height:80px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>${tokens.refresh_token || 'Not provided - you may need to revoke and re-authorize'}</textarea>

  <h3>GOOGLE_BUSINESS_ACCESS_TOKEN:</h3>
  <textarea style="width:100%; height:80px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>${tokens.access_token}</textarea>

  <h3>GOOGLE_BUSINESS_REFRESH_TOKEN:</h3>
  <textarea style="width:100%; height:80px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; padding:0.5rem;" readonly>${tokens.refresh_token || 'Use the same refresh token as YOUTUBE_REFRESH_TOKEN'}</textarea>
  
  <h3>Token expires in:</h3>
  <p>${tokens.expires_in} seconds</p>
  
  <p style="color: #f59e0b; margin-top: 2rem;">The YouTube and Google Business connectors can use this same Google OAuth grant. Save the refresh token - it lets both connectors get new access tokens without re-authorizing.</p>
  <p style="color: #ef4444;">Close this page after copying. Do not share these values.</p>
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html' },
  });
}

export const config = { runtime: 'edge' };
