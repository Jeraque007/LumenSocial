// Facebook connector using Graph API v25.0
// Requires FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_PAGE_ID in environment variables.
// Obtain a Page Access Token via: /api/auth/facebook-token

import { applyAttribution } from './attribution';

const FACEBOOK_IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const FACEBOOK_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/tiff',
  'image/heif',
  'image/heic',
  'image/webp',
]);

async function validateFacebookMediaUrl(mediaUrl: string): Promise<string | null> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(mediaUrl);
  } catch {
    return 'Facebook media URL is not a valid URL';
  }

  if (parsedUrl.protocol !== 'https:') {
    return 'Facebook media URL must use HTTPS';
  }

  let response: Response;
  try {
    response = await fetch(parsedUrl, { method: 'HEAD' });
  } catch {
    return 'Facebook could not reach the media URL';
  }

  // Some storage/CDN providers do not implement HEAD. A one-byte range request
  // still lets us inspect the public response without downloading the full file.
  if (!response.ok || !response.headers.get('content-type') || !response.headers.get('content-length')) {
    try {
      response = await fetch(parsedUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
    } catch {
      return 'Facebook could not download the media URL';
    }
  }

  if (!response.ok) {
    return `Facebook could not download the media URL (HTTP ${response.status})`;
  }

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  if (!FACEBOOK_IMAGE_TYPES.has(contentType)) {
    return `Facebook media URL returned ${contentType || 'no content type'}, not a supported image`;
  }

  const contentRange = response.headers.get('content-range');
  const rangeMatch = contentRange?.match(/\/([0-9]+)$/);
  const contentLength = Number(response.headers.get('content-length'));
  const sizeBytes = rangeMatch ? Number(rangeMatch[1]) : contentLength;

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return 'Facebook could not determine the image size';
  }

  if (sizeBytes > FACEBOOK_IMAGE_LIMIT_BYTES) {
    return `Facebook image is too large (${(sizeBytes / 1024 / 1024).toFixed(1)} MB); maximum is 10 MB`;
  }

  return null;
}

// Meta returns error 190 "…must be granted before impersonating a user's page" when a USER access
// token is sent to /{page-id}/feed|photos|videos: those endpoints require a PAGE access token. The
// same detection lets us derive the Page token from the User token and retry automatically.
function isPageTokenRequiredError(body: string): boolean {
  return (
    /impersonating a user's page/i.test(body) ||
    (/"code"\s*:\s*190/.test(body) && /pages_(read_engagement|show_list|manage_posts)/.test(body))
  );
}

// Meta answers error 190 with subcode 463/467 (or the text "Session has expired") when the token
// itself has expired. A Page token derived from a short-lived User token (Graph API Explorer) only
// lives 1-2 hours, so this is the most common production failure. Kept separate from
// isPageTokenRequiredError: an expired token must be REPLACED, not re-derived.
function isTokenExpiredError(body: string): boolean {
  return (
    /session has expired|has expired on|access token has expired|expired access token/i.test(body) ||
    (/"(?:code|error_subcode)"\s*:\s*(?:190|463|467)\b/.test(body) && /expir/i.test(body))
  );
}

// Exchange a User access token for the Page token of {pageId} — the documented flow used by
// /api/auth/facebook-token (GET /{page-id}?fields=access_token). It only succeeds when the User token
// carries pages_show_list (+ pages_read_engagement) for that Page.
async function resolvePageAccessToken(pageId: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const response = await fetch(
        `https://graph.facebook.com/v25.0/${pageId}?fields=id,name,access_token&access_token=${encodeURIComponent(candidate)}`
      );
      if (!response.ok) continue;
      const data = await response.json();
      if (typeof data?.access_token === 'string' && data.access_token.length > 0) {
        return data.access_token;
      }
    } catch {
      // Try the next candidate token.
    }
  }
  return null;
}

interface PageCredentials {
  pageId: string;
  tokenVar: string;
  pageIdVar: string;
  userTokenVar: string;
  tokens: string[];
}

function permissionHint(status: number, credentials: PageCredentials, body: string): string {
  const { tokenVar, pageIdVar, pageId, userTokenVar } = credentials;
  // /api/auth/facebook-token prints the HOAWS_FACEBOOK_* names when passed ?brand=HOAWS.
  const brandSuffix = userTokenVar === 'HOAWS_FACEBOOK_USER_ACCESS_TOKEN' ? '&brand=HOAWS' : '';

  if (isTokenExpiredError(body)) {
    return (
      ` — ${tokenVar} is EXPIRED or invalid: Meta error 190 with "Session has expired". A Page token ` +
      `derived from a short-lived User token (Graph API Explorer) lives only 1-2 hours. Exchange the User ` +
      `token for a 60-day long-lived one first ` +
      `(GET /oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET` +
      `&fb_exchange_token=SHORT_LIVED_TOKEN), then mint a fresh Page token at ` +
      `/api/auth/facebook-token?user_token=YOUR_USER_TOKEN&page_id=${pageId}${brandSuffix} and set ${tokenVar}. ` +
      `Also set ${userTokenVar} to that long-lived User token so the app refreshes the Page token by itself.`
    );
  }

  if (isPageTokenRequiredError(body)) {
    return (
      ` — ${tokenVar} holds a USER access token, not a PAGE access token, which is what error 190 ` +
      `"…must be granted before impersonating a user's page" means. Put the PAGE token for ` +
      `${pageIdVar}=${pageId} in ${tokenVar}; generate it at /api/auth/facebook-token?user_token=YOUR_USER_TOKEN` +
      `&page_id=${pageId}${brandSuffix}, and set ` +
      `${userTokenVar} to a User token that carries pages_show_list so the app derives the Page token itself.`
    );
  }
  if (status !== 403 && status !== 401) return '';
  return ` — check that ${tokenVar} is a Page Access Token for ${pageIdVar}=${pageId} carrying pages_manage_posts + pages_read_engagement, then regenerate it at /api/auth/facebook-token?user_token=...&page_id=${pageId}`;
}

// Publishes with the configured token. When Meta rejects it because it is a User token rather than a
// Page token, the Page token is derived from the User token and the call is retried exactly once, so
// publishing recovers without a redeploy.
async function sendWithPageTokenFallback(
  label: string,
  doPublish: (token: string) => Promise<Response>,
  credentials: PageCredentials
): Promise<{ success: boolean; error?: string }> {
  const firstResponse = await doPublish(credentials.tokens[0]);

  if (firstResponse.ok) {
    return { success: true };
  }

  const firstBody = await firstResponse.text();
  // Derive a Page token when the configured token is a User token, or when it has expired and a User
  // token is configured to mint a replacement from. Any other failure (rate limit, bad media) is
  // reported as-is so no extra Graph calls are spent.
  const shouldDerivePageToken =
    isPageTokenRequiredError(firstBody) ||
    (isTokenExpiredError(firstBody) && credentials.tokens.length > 1);
  const pageToken = shouldDerivePageToken
    ? await resolvePageAccessToken(credentials.pageId, credentials.tokens)
    : null;

  if (!pageToken || pageToken === credentials.tokens[0]) {
    return {
      success: false,
      error: `${label} ${firstResponse.status}: ${firstBody}${permissionHint(firstResponse.status, credentials, firstBody)}`,
    };
  }

  const retryResponse = await doPublish(pageToken);

  if (retryResponse.ok) {
    return { success: true };
  }

  const retryBody = await retryResponse.text();
  return {
    success: false,
    error:
      `${label} ${retryResponse.status} even after deriving a Page Access Token from the User token for ` +
      `page ${credentials.pageId}: ${retryBody}${permissionHint(retryResponse.status, credentials, retryBody)}`,
  };
}

export async function postToFacebook(
  content: string,
  mediaUrl?: string,
  brand?: string
): Promise<{ success: boolean; error?: string }> {
  // Brand routing is case/whitespace insensitive so 'HOAWS', 'hoaws' and 'Hoaws ' all resolve
  // to the HOAWS Page instead of silently publishing to the S.A.E Method Page.
  const normalizedBrand = (brand || '').trim().toLowerCase();
  const useHoawsCredentials = normalizedBrand === 'hoaws';
  const brandLabel = brand?.trim() || 'S.A.E Method';
  const accessToken = (useHoawsCredentials
    ? process.env.HOAWS_FACEBOOK_PAGE_ACCESS_TOKEN
    : process.env.FACEBOOK_PAGE_ACCESS_TOKEN)?.trim();
  const pageId = (useHoawsCredentials
    ? process.env.HOAWS_FACEBOOK_PAGE_ID
    : process.env.FACEBOOK_PAGE_ID)?.trim();
  const tokenVar = useHoawsCredentials ? 'HOAWS_FACEBOOK_PAGE_ACCESS_TOKEN' : 'FACEBOOK_PAGE_ACCESS_TOKEN';
  const pageIdVar = useHoawsCredentials ? 'HOAWS_FACEBOOK_PAGE_ID' : 'FACEBOOK_PAGE_ID';
  // Optional User token used to derive the Page token when the Page token variables accidentally hold
  // a User token (Meta error 190 "impersonating a user's page"). Static process.env access keeps these
  // variables visible to the Vercel Edge bundler.
  const userTokenVar = useHoawsCredentials ? 'HOAWS_FACEBOOK_USER_ACCESS_TOKEN' : 'FACEBOOK_USER_ACCESS_TOKEN';
  const configuredUserToken = (useHoawsCredentials
    ? process.env.HOAWS_FACEBOOK_USER_ACCESS_TOKEN
    : process.env.FACEBOOK_USER_ACCESS_TOKEN)?.trim();
  // The configured token is tried first (it may already be a Page token), then the explicit User token.
  const tokenCandidates = [accessToken, configuredUserToken].filter(
    (token): token is string => Boolean(token)
  );
  if (!accessToken || !pageId) {
    return {
      success: false,
      error: `${tokenVar} or ${pageIdVar} is not set for brand "${brandLabel}". Visit /api/auth/facebook-token to generate a Page Access Token.`,
    };
  }

  if (!/^\d+$/.test(pageId)) {
    return {
      success: false,
      error: `${pageIdVar} is invalid: expected only the numeric Page ID, received "${pageId}".`,
    };
  }

  // Built after the guards above so the IDs are narrowed to string (pageId is used in the Graph URLs).
  const pageCredentials: PageCredentials = {
    pageId,
    tokenVar,
    pageIdVar,
    userTokenVar,
    tokens: tokenCandidates,
  };

  const isVideo = Boolean(mediaUrl && /\.(mp4|mov|avi|webm)(\?|$)/i.test(mediaUrl));

  if (mediaUrl && !isVideo) {
    const mediaError = await validateFacebookMediaUrl(mediaUrl);
    if (mediaError) {
      return { success: false, error: mediaError };
    }
  }

  let url: string;
  let body: Record<string, string>;
  const finalContent = applyAttribution(content);

  if (isVideo && mediaUrl) {
    let videoResponse: Response;
    try {
      videoResponse = await fetch(mediaUrl);
    } catch {
      return { success: false, error: 'Facebook could not download the video URL' };
    }

    if (!videoResponse.ok) {
      return { success: false, error: `Facebook video download failed: HTTP ${videoResponse.status}` };
    }

    const videoType = videoResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (videoType !== 'video/mp4') {
      return { success: false, error: `Facebook video URL returned ${videoType || 'no content type'}; Facebook requires video/mp4` };
    }

    const videoBytes = await videoResponse.arrayBuffer();
    const uploadVideo = (token: string) => {
      const formData = new FormData();
      formData.append('source', new File([videoBytes], 'video.mp4', { type: 'video/mp4' }));
      formData.append('title', finalContent.substring(0, 100));
      formData.append('description', finalContent);
      formData.append('access_token', token);

      return fetch(`https://graph-video.facebook.com/v25.0/${pageId}/videos`, {
        method: 'POST',
        body: formData,
      });
    };

    return await sendWithPageTokenFallback(
      'Facebook video upload failed',
      uploadVideo,
      pageCredentials
    );
  } else if (mediaUrl) {
    url = `https://graph.facebook.com/v25.0/${pageId}/photos`;
    body = {
      url: mediaUrl,
      caption: finalContent,
    };
  } else {
    url = `https://graph.facebook.com/v25.0/${pageId}/feed`;
    body = {
      message: finalContent,
    };
  }

  return await sendWithPageTokenFallback(
    'Facebook API error',
    (token) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, access_token: token }),
      }),
    pageCredentials
  );
}
