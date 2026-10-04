// Starts the LinkedIn OAuth flow
// Visit this URL to begin authorization: https://lumensocial.vercel.app/api/auth/linkedin

export default async function handler(_req: Request) {
  const clientId = process.env.LINKEDIN_CLIENT_ID!;
  const redirectUri = 'https://lumensocial.vercel.app/api/auth/linkedin-callback';

  // Requested OAuth 2.0 scopes for LinkedIn consent.
  const scopes = [
    'openid',
    'profile',
    'w_member_social',
    'email',
  ].join(' ');

  const state = crypto.randomUUID();

  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

export const config = { runtime: 'edge' };