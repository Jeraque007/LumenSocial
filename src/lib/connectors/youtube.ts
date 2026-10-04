// YouTube connector using YouTube Data API v3

import { applyAttribution } from './attribution';

/**
 * Returns a valid YouTube access token, refreshing it automatically if expired.
 * Requires YOUTUBE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET in env.
 */
async function getValidYouTubeToken(): Promise<string> {
  const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

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
      'YOUTUBE_ACCESS_TOKEN is expired and YOUTUBE_REFRESH_TOKEN is not set. ' +
      'Re-authorize at /api/auth/google to obtain a new refresh token.'
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
    try {
      const details = JSON.parse(err) as { error?: string };
      if (details.error === 'invalid_grant') {
        throw new Error(
          'YouTube refresh token is invalid or revoked. Re-authorize at /api/auth/google, then update YOUTUBE_ACCESS_TOKEN and YOUTUBE_REFRESH_TOKEN in Vercel.'
        );
      }
    } catch (parseError: unknown) {
      if (parseError instanceof Error && parseError.message.startsWith('YouTube refresh token')) {
        throw parseError;
      }
    }
    throw new Error(`Failed to refresh YouTube token: ${err}`);
  }

  const data = await tokenRes.json();

  if (!data.access_token) {
    throw new Error(`Refresh token exchange succeeded but no access_token returned: ${JSON.stringify(data)}`);
  }

  return data.access_token as string;
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
  mediaUrl?: string
): Promise<{ success: boolean; error?: string }> {
  if (!mediaUrl) {
    return { success: false, error: 'YouTube requires a video URL for posting' };
  }

  let accessToken: string;
  try {
    accessToken = await getValidYouTubeToken();
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
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
