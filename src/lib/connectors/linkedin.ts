// LinkedIn connector using Community Management API (Posts API)
// Auto-refreshes the brand-specific access token when expired.
// Authorize at: https://lumensocial.vercel.app/api/auth/linkedin

import { applyAttribution } from './attribution';

async function getValidLinkedInToken(usePersonalCredentials: boolean): Promise<string> {
  const accessToken = usePersonalCredentials
    ? process.env.LINKEDIN_PERSONAL_ACCESS_TOKEN
    : process.env.LINKEDIN_ACCESS_TOKEN;
  const refreshToken = usePersonalCredentials
    ? process.env.LINKEDIN_PERSONAL_REFRESH_TOKEN
    : process.env.LINKEDIN_REFRESH_TOKEN;

  // Check stored access token with a lightweight introspection call
  if (accessToken) {
    const check = await fetch('https://www.linkedin.com/oauth/v2/introspectToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: accessToken,
        client_id: process.env.LINKEDIN_CLIENT_ID!,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
      }),
    });
    if (check.ok) {
      const info = await check.json();
      // expires_at is a Unix timestamp in seconds
      const expiresAt = info.expires_at ? Number(info.expires_at) : 0;
      const nowSecs = Math.floor(Date.now() / 1000);
      if (info.active === true && expiresAt - nowSecs > 300) {
        return accessToken;
      }
    }
    // Token invalid or expiring within 5 minutes — fall through to refresh
  }

  if (!refreshToken) {
    throw new Error(
      (usePersonalCredentials
        ? 'LINKEDIN_PERSONAL_ACCESS_TOKEN is expired and LINKEDIN_PERSONAL_REFRESH_TOKEN is not set. '
        : 'LINKEDIN_ACCESS_TOKEN is expired and LINKEDIN_REFRESH_TOKEN is not set. ') +
      'Re-authorize at https://lumensocial.vercel.app/api/auth/linkedin'
    );
  }

  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Failed to refresh LinkedIn token: ${err}`);
  }

  const data = await tokenRes.json();
  if (!data.access_token) {
    throw new Error('LinkedIn refresh succeeded but no access_token was returned');
  }

  return data.access_token as string;
}

const LINKEDIN_VERSION = '202603';

function linkedInHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

async function uploadLinkedInImage(accessToken: string, ownerUrn: string, mediaUrl: string): Promise<string> {
  const mediaResponse = await fetch(mediaUrl);
  if (!mediaResponse.ok) throw new Error(`LinkedIn image download failed: HTTP ${mediaResponse.status}`);

  const contentType = mediaResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(contentType)) {
    throw new Error(`LinkedIn image requires JPG, PNG, GIF, or WebP; received ${contentType || 'unknown type'}`);
  }

  const initResponse = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST',
    headers: linkedInHeaders(accessToken),
    body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
  });
  if (!initResponse.ok) throw new Error(`LinkedIn image initialization failed: ${await initResponse.text()}`);

  const initData = await initResponse.json();
  const uploadUrl = initData.value?.uploadUrl;
  const imageUrn = initData.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error('LinkedIn image initialization returned no upload URL or image URN');

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: await mediaResponse.arrayBuffer(),
  });
  if (!uploadResponse.ok) throw new Error(`LinkedIn image upload failed: HTTP ${uploadResponse.status}`);

  for (let attempt = 0; attempt < 12; attempt++) {
    const statusResponse = await fetch(`https://api.linkedin.com/rest/images/${encodeURIComponent(imageUrn)}`, {
      headers: linkedInHeaders(accessToken),
    });
    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      if (statusData.status === 'AVAILABLE') return imageUrn;
      if (statusData.status === 'PROCESSING_FAILED') throw new Error(`LinkedIn image processing failed: ${statusData.processingFailureReason || 'unknown reason'}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('LinkedIn image processing timed out');
}

async function uploadLinkedInVideo(accessToken: string, ownerUrn: string, mediaUrl: string): Promise<string> {
  const mediaResponse = await fetch(mediaUrl);
  if (!mediaResponse.ok) throw new Error(`LinkedIn video download failed: HTTP ${mediaResponse.status}`);

  const contentType = mediaResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  if (contentType !== 'video/mp4') throw new Error(`LinkedIn video requires video/mp4; received ${contentType || 'unknown type'}`);

  const videoBuffer = await mediaResponse.arrayBuffer();
  const fileSizeBytes = videoBuffer.byteLength;
  if (fileSizeBytes < 75 * 1024 || fileSizeBytes > 500 * 1024 * 1024) {
    throw new Error('LinkedIn video must be between 75 KB and 500 MB');
  }

  const initResponse = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
    method: 'POST',
    headers: linkedInHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: ownerUrn,
        fileSizeBytes,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });
  if (!initResponse.ok) throw new Error(`LinkedIn video initialization failed: ${await initResponse.text()}`);

  const initData = await initResponse.json();
  const uploadValue = initData.value;
  const videoUrn = uploadValue?.video;
  const instructions = uploadValue?.uploadInstructions || [];
  if (!videoUrn || instructions.length === 0) throw new Error('LinkedIn video initialization returned no upload instructions');

  const uploadedPartIds: string[] = [];
  for (const instruction of instructions) {
    const chunk = videoBuffer.slice(instruction.firstByte, instruction.lastByte + 1);
    const uploadResponse = await fetch(instruction.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chunk,
    });
    if (!uploadResponse.ok) throw new Error(`LinkedIn video part upload failed: HTTP ${uploadResponse.status}`);
    const etag = uploadResponse.headers.get('etag');
    if (!etag) throw new Error('LinkedIn video upload returned no ETag');
    uploadedPartIds.push(etag.replace(/^"|"$/g, ''));
  }

  const finalizeResponse = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
    method: 'POST',
    headers: linkedInHeaders(accessToken),
    body: JSON.stringify({ finalizeUploadRequest: { video: videoUrn, uploadToken: uploadValue.uploadToken || '', uploadedPartIds } }),
  });
  if (!finalizeResponse.ok) throw new Error(`LinkedIn video finalization failed: ${await finalizeResponse.text()}`);

  for (let attempt = 0; attempt < 30; attempt++) {
    const statusResponse = await fetch(`https://api.linkedin.com/rest/videos/${encodeURIComponent(videoUrn)}`, {
      headers: linkedInHeaders(accessToken),
    });
    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      if (statusData.status === 'AVAILABLE') return videoUrn;
      if (statusData.status === 'PROCESSING_FAILED') throw new Error(`LinkedIn video processing failed: ${statusData.processingFailureReason || 'unknown reason'}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('LinkedIn video processing timed out');
}

export async function postToLinkedin(
  content: string,
  mediaUrl?: string,
  brand?: string
): Promise<{ success: boolean; error?: string }> {
  // Brand routing is case/whitespace insensitive so 'HOAWS', 'hoaws' and 'Hoaws ' all resolve to
  // Sylvana Ellis' main PERSONAL LinkedIn profile instead of silently publishing to the S.A.E
  // organisation account (urn:li:organization:136814040). Facebook and Instagram keep their own
  // HOAWS routing - this only changes LinkedIn.
  const normalizedBrand = (brand || '').trim().toLowerCase();
  const usePersonalCredentials = normalizedBrand === 'tessera lumen' || normalizedBrand === 'hoaws';
  const authorUrn = usePersonalCredentials
    ? (process.env.LINKEDIN_PERSONAL_AUTHOR_URN || 'urn:li:person:fIIDbdJEw4')
    : (process.env.LINKEDIN_AUTHOR_URN || 'urn:li:organization:136814040');

  let accessToken: string;
  try {
    accessToken = await getValidLinkedInToken(usePersonalCredentials);
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message };
  }

  const finalContent = applyAttribution(content);

  const postBody: Record<string, unknown> = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    visibility: 'PUBLIC',
    commentary: finalContent,
    distribution: {
      feedDistribution: 'MAIN_FEED',
    },
  };

  if (mediaUrl) {
    try {
      const isVideo = /\.(mp4|mov|avi|webm)(\?|$)/i.test(mediaUrl);
      const mediaUrn = isVideo
        ? await uploadLinkedInVideo(accessToken, authorUrn, mediaUrl)
        : await uploadLinkedInImage(accessToken, authorUrn, mediaUrl);
      postBody.content = {
        media: {
          id: mediaUrn,
          ...(isVideo ? { title: finalContent.substring(0, 100) } : { altText: finalContent.substring(0, 4086) }),
        },
      };
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message };
    }
  }

  const response = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': LINKEDIN_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(postBody),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `LinkedIn API error ${response.status}: ${err}` };
  }

  return { success: true };
}