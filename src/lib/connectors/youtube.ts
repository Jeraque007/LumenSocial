// YouTube connector using YouTube Data API v3
//
// TWO channels, ONE Google account. Both channels below are managed by the same Gmail login, but
// the YouTube Data API has no per-request channel selector (onBehalfOfContentOwner is for content
// partners only) - a grant always posts to the channel picked when the grant was created in
// Google's account / brand-account chooser. So each brand carries its own token pair, following the
// same split the Facebook and Instagram connectors use:
//   brand 'S.A.E Method' (default) -> @sylvana_sae - UC05CiyeaqlzPXFEeAO485OQ - YOUTUBE_*
//   brand 'HOAWS'                  -> @HOAWS-963   - UCvcko1F9hbSN2cYEJgRnkvQ  - HOAWS_YOUTUBE_*
// Grants are minted at /api/auth/google (select the S.A.E channel in Google's chooser) and at
// /api/auth/google?brand=HOAWS (select the HOAWS channel).
//
// Before any upload the connector asks channels.list which channel the token actually acts on and
// refuses to publish on a mismatch, so a swapped or stale env var can never post HOAWS content to
// the S.A.E channel or vice versa.

import { applyAttribution } from './attribution';

// Known channel IDs for the two channels. Override per brand with YOUTUBE_CHANNEL_ID /
// HOAWS_YOUTUBE_CHANNEL_ID if a channel ID ever changes.
const SAE_CHANNEL_ID = 'UC05CiyeaqlzPXFEeAO485OQ';   // @sylvana_sae - "Sovereign Authority Expansion"
const HOAWS_CHANNEL_ID = 'UCvcko1F9hbSN2cYEJgRnkvQ'; // @HOAWS-963 - "HOAWS - Human Online Administrative Web Solutions"

interface YouTubeCredentials {
  accessToken?: string;
  refreshToken?: string;
  /** Channel this brand's tokens MUST act on; uploads are refused before any bytes move otherwise. */
  expectedChannelId: string;
  accessVar: string;
  refreshVar: string;
  channelVar: string;
  /** Where to mint a fresh grant for this brand. */
  authUrl: string;
  brandLabel: string;
}

/**
 * Maps the scheduled post's brand to that brand's environment variables. Unset or unknown brands
 * fall back to the S.A.E Method defaults, mirroring the Facebook/Instagram connectors.
 */
function resolveYouTubeCredentials(brand?: string): YouTubeCredentials {
  const useHoawsCredentials = (brand || '').trim().toLowerCase() === 'hoaws';
  // Static process.env accesses keep these variable names visible to the Vercel Edge bundler.
  if (useHoawsCredentials) {
    return {
      accessToken: process.env.HOAWS_YOUTUBE_ACCESS_TOKEN,
      refreshToken: process.env.HOAWS_YOUTUBE_REFRESH_TOKEN,
      expectedChannelId: (process.env.HOAWS_YOUTUBE_CHANNEL_ID || '').trim() || HOAWS_CHANNEL_ID,
      accessVar: 'HOAWS_YOUTUBE_ACCESS_TOKEN',
      refreshVar: 'HOAWS_YOUTUBE_REFRESH_TOKEN',
      channelVar: 'HOAWS_YOUTUBE_CHANNEL_ID',
      authUrl: 'https://lumensocial.vercel.app/api/auth/google?brand=HOAWS',
      brandLabel: 'HOAWS',
    };
  }
  return {
    accessToken: process.env.YOUTUBE_ACCESS_TOKEN,
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
    expectedChannelId: (process.env.YOUTUBE_CHANNEL_ID || '').trim() || SAE_CHANNEL_ID,
    accessVar: 'YOUTUBE_ACCESS_TOKEN',
    refreshVar: 'YOUTUBE_REFRESH_TOKEN',
    channelVar: 'YOUTUBE_CHANNEL_ID',
    authUrl: 'https://lumensocial.vercel.app/api/auth/google',
    brandLabel: 'S.A.E Method',
  };
}

/**
 * Returns a valid YouTube access token for the brand's grant, refreshing it automatically if
 * expired. Requires the brand's refresh token plus GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
 */
async function getValidYouTubeToken(creds: YouTubeCredentials): Promise<string> {
  const accessToken = creds.accessToken;
  const refreshToken = creds.refreshToken;

  // Try the stored access token first via Google's v3 tokeninfo endpoint
  // (v1 is deprecated — always use v3)
  if (accessToken) {
    const check = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (check.ok) {
      const info = await check.json();
      // expires_in is in seconds; treat as valid if more than 60 s remain
      if (info.expires_in && Number(info.expires_in) > 60) {
        return accessToken;
      }
    }
    // If check fails (400/401) or token is nearly expired, fall through to refresh
  }

  // Access token is missing or expired — use the refresh token
  if (!refreshToken) {
    throw new Error(
      `${creds.accessVar} is expired or unset and ${creds.refreshVar} is not set for brand "${creds.brandLabel}". ` +
      `Re-authorize at ${creds.authUrl} to obtain a new refresh token.`
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
    let details: { error?: string } | null = null;
    try {
      details = JSON.parse(err) as { error?: string };
    } catch {
      // Body was not JSON; fall through to the generic error below.
    }
    if (details?.error === 'invalid_grant') {
      throw new Error(
        `${creds.refreshVar} is invalid or revoked for brand "${creds.brandLabel}". ` +
        `Re-authorize at ${creds.authUrl}, then update ${creds.accessVar} and ${creds.refreshVar} in Vercel.`
      );
    }
    throw new Error(`Failed to refresh YouTube token (${creds.refreshVar}): ${err}`);
  }

  const data = await tokenRes.json();

  if (!data.access_token) {
    throw new Error(`Refresh token exchange succeeded but no access_token returned: ${JSON.stringify(data)}`);
  }

  return data.access_token as string;
}

/**
 * Asks the YouTube Data API which channel `accessToken` actually acts on and compares it with the
 * channel the brand expects. Returns an error message that blocks the upload, or null when
 * verified. Fails closed: if the check itself cannot complete, nothing is uploaded either, because
 * a video published to the wrong channel cannot be recalled.
 */
async function verifyYouTubeChannel(
  accessToken: string,
  creds: YouTubeCredentials
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
  } catch {
    return `Could not verify which YouTube channel ${creds.accessVar} posts to (network error); refusing to upload for brand "${creds.brandLabel}".`;
  }

  if (!response.ok) {
    const err = await response.text();
    return `Could not verify which YouTube channel ${creds.accessVar} posts to for brand "${creds.brandLabel}" (channels.list HTTP ${response.status}): ${err}`;
  }

  const data = await response.json() as {
    items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }>;
  };
  const channel = data.items?.[0];
  const actualChannelId = channel?.id || '';
  if (!actualChannelId) {
    return `channels.list returned no channel for ${creds.accessVar} (brand "${creds.brandLabel}"); refusing to upload.`;
  }

  if (actualChannelId !== creds.expectedChannelId) {
    const title = channel?.snippet?.title ? ` "${channel.snippet.title}"` : '';
    const handle = channel?.snippet?.customUrl ? ` ${channel.snippet.customUrl}` : '';
    return (
      `YouTube channel mismatch for brand "${creds.brandLabel}": ${creds.accessVar} posts to ` +
      `${actualChannelId}${title}${handle}, but this brand must post to ${creds.expectedChannelId}. ` +
      `Re-authorize at ${creds.authUrl} selecting the correct channel, then update ${creds.accessVar} ` +
      `and ${creds.refreshVar} in Vercel. (The expected channel can be changed via ${creds.channelVar}.)`
    );
  }

  return null;
}

function parseYouTubeContent(content: string): { title: string; description: string } {
  const fallbackTitle = content.substring(0, 100) || 'Untitled';
  const fallbackDescription = content || '';

  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      const title = typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim().substring(0, 100)
        : fallbackTitle;
      const description = typeof parsed.description === 'string'
        ? parsed.description
        : fallbackDescription;
      return { title, description };
    }
  } catch {
    // Not JSON; use plain-text fallback.
  }

  return { title: fallbackTitle, description: fallbackDescription };
}

export async function postToYoutube(
  content: string,
  mediaUrl?: string,
  brand?: string
): Promise<{ success: boolean; error?: string }> {
  if (!mediaUrl) {
    return { success: false, error: 'YouTube requires a video URL for posting' };
  }

  const creds = resolveYouTubeCredentials(brand);

  let accessToken: string;
  try {
    accessToken = await getValidYouTubeToken(creds);
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }

  // Both channels live under one Gmail, so the classic failure is a swapped env var posting to the
  // wrong channel. Verify before uploading - an upload cannot be undone.
  const channelError = await verifyYouTubeChannel(accessToken, creds);
  if (channelError) {
    return { success: false, error: channelError };
  }

  // Download the video to buffer
  const videoResponse = await fetch(mediaUrl);
  if (!videoResponse.ok) {
    return { success: false, error: `Failed to download video from media URL: ${videoResponse.status}` };
  }
  const videoBuffer = await videoResponse.arrayBuffer();

  const parsedContent = parseYouTubeContent(content);
  const attributedDescription = applyAttribution(parsedContent.description);

  const metadata = {
    snippet: {
      title: parsedContent.title,
      description: attributedDescription,
      categoryId: '22', // People & Blogs
    },
    status: {
      privacyStatus: 'public',
      selfDeclaredMadeForKids: false,
    },
  };

  // Step 1: Initiate the resumable upload session
  const initResponse = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': videoBuffer.byteLength.toString(),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initResponse.ok) {
    const err = await initResponse.text();
    return { success: false, error: `YouTube upload init failed: ${err}` };
  }

  // Step 2: Get the resumable upload URI from the Location header
  const uploadUrl = initResponse.headers.get('location');
  if (!uploadUrl) {
    return { success: false, error: 'YouTube did not return a resumable upload URL in the Location header' };
  }

  // Step 3: Upload the video binary to the resumable upload URI
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': videoBuffer.byteLength.toString(),
    },
    body: videoBuffer,
  });

  if (!uploadResponse.ok) {
    const err = await uploadResponse.text();
    return { success: false, error: `YouTube video upload failed: ${err}` };
  }

  return { success: true };
}
