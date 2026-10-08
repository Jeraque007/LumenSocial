// Starts the Google OAuth flow for YouTube + Google Business
// Visit this URL to begin authorization
//   /api/auth/google              -> S.A.E Method channel; result page labels YOUTUBE_* vars
//   /api/auth/google?brand=HOAWS  -> HOAWS channel;         result page labels HOAWS_YOUTUBE_* vars
// Both channels live under one Google account, but a grant only ever posts to the channel picked
// during THIS authorization (the YouTube API has no channel selector), so each brand gets its own
// visit - select the target channel in Google's account / brand-account chooser.

export default async function handler(req: Request) {
  const url = new URL(req.url);
  // Round-trips through OAuth `state` so /api/auth/callback knows which brand's vars to label.
  const brand = (url.searchParams.get('brand') || '').trim().toLowerCase() === 'hoaws' ? 'HOAWS' : 'SAE';
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const redirectUri = 'https://lumensocial.vercel.app/api/auth/callback';

  // The HOAWS channel lives on a Brand Account, and Google answers a brand-account consent that
  // includes business.manage with "Service unavailable - You tried to access a service that isn't
  // available for your account". The HOAWS grant only ever uploads videos (Google Business Profile
  // follows the S.A.E / YOUTUBE_* grant), so it requests the YouTube scopes alone. The S.A.E visit
  // keeps business.manage so the Google Business fallback token stays renewable.
  const scopes = (brand === 'HOAWS'
    ? [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
      ]
    : [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/business.manage',
      ]
  ).join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', brand);

  return Response.redirect(authUrl.toString(), 302);
}

export const config = { runtime: 'edge' };
