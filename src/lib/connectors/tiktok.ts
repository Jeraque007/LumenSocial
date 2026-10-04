// TikTok connector using Content Posting API (Direct Post)
export async function postToTiktok(
  content: string,
  mediaUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN!;

  if (!mediaUrl) {
    return { success: false, error: 'TikTok requires a video URL for posting' };
  }

  const creatorInfoResponse = await fetch(
    'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!creatorInfoResponse.ok) {
    const err = await creatorInfoResponse.text();
    return { success: false, error: `TikTok creator info query failed: ${err}` };
  }

  const initResponse = await fetch(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: content.substring(0, 150),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: mediaUrl,
        },
      }),
    }
  );

  if (!initResponse.ok) {
    const err = await initResponse.text();
    return { success: false, error: `TikTok post init failed: ${err}` };
  }

  const initData = await initResponse.json();
  const publishId = initData.data?.publish_id;

  if (!publishId) {
    return { success: false, error: 'TikTok did not return a publish_id' };
  }

  let attempts = 0;
  while (attempts < 10) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusResponse = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ publish_id: publishId }),
      }
    );
    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      const status = statusData.data?.status;
      if (status === 'PUBLISH_COMPLETE') return { success: true };
      if (status === 'FAILED') return { success: false, error: `TikTok publish failed: ${statusData.data?.fail_reason || 'Unknown'}` };
    }
    attempts++;
  }

  return { success: false, error: 'TikTok publish timed out' };
}
