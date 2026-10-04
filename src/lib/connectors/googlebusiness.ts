// Google Business Profile connector
// Uses the current Business Profile API v4 Local Posts endpoint.
// Shares OAuth credentials with YouTube. Dedicated GOOGLE_BUSINESS_* values take
// precedence, with YOUTUBE_* values as a fallback for one shared Google grant.

const DEFAULT_GOOGLE_BUSINESS_LOCATION = 'accounts/5356522963805079021/locations/3437227536673213265';

async function getValidGoogleBusinessToken(): Promise<string> {
  const accessToken = process.env.GOOGLE_BUSINESS_ACCESS_TOKEN
    || process.env.google_business_access_token
    || process.env.YOUTUBE_ACCESS_TOKEN;
  const refreshToken = process.env.GOOGLE_BUSINESS_REFRESH_TOKEN
    || process.env.google_business_refresh_token
    || process.env.YOUTUBE_REFRESH_TOKEN;

  // Check stored access token via v3 tokeninfo
  if (accessToken) {
    const check = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (check.ok) {
      const info = await check.json();
      if (info.expires_in && Number(info.expires_in) > 60) return accessToken;
    }
  }

  if (!refreshToken) {
    throw new Error(
      'Google Business access token is expired and no Google refresh token is set. ' +
      'Re-authorize at /api/auth/google to obtain a refresh token.'
    );
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Failed to refresh Google Business token: ${err}`);
  }

  const data = await tokenRes.json();
  if (!data.access_token) throw new Error('No access_token returned from refresh');
  return data.access_token as string;
}

export async function postToGoogleBusiness(
  content: string,
  mediaUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const locationName = process.env.GOOGLE_BUSINESS_LOCATION
    || process.env.google_business_location
    || DEFAULT_GOOGLE_BUSINESS_LOCATION;

  if (!locationName) {
    return { success: false, error: 'GOOGLE_BUSINESS_LOCATION is not set' };
  }

  let accessToken: string;
  try {
    accessToken = await getValidGoogleBusinessToken();
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }

  const postBody: Record<string, unknown> = {
    languageCode: 'en',
    summary: content,
    topicType: 'STANDARD',
  };

  if (mediaUrl) {
    postBody.media = [{ mediaFormat: 'PHOTO', sourceUrl: mediaUrl }];
  }

  const response = await fetch(
    `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postBody),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 403 && err.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      return {
        success: false,
        error: 'Google Business token lacks the business.manage scope. Re-authorize at /api/auth/google, update the Google access and refresh tokens in Vercel, and confirm the Business Profile API is enabled.',
      };
    }
    return { success: false, error: `Google Business API error ${response.status}: ${err}` };
  }

  return { success: true };
}