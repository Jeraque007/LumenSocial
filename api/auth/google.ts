// Starts the Google OAuth flow for YouTube + Google Business
// Visit this URL to begin authorization

export default async function handler(_req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const redirectUri = 'https://lumensocial.vercel.app/api/auth/callback';
  
  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/business.manage',
  ].join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  return Response.redirect(authUrl.toString(), 302);
}

export const config = { runtime: 'edge' };
