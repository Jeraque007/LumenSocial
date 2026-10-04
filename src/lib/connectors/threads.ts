// Threads connector using Meta Threads API
// Requires threads_basic and threads_content_publish permissions

export async function postToThreads(
  content: string,
  mediaUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const accessToken = process.env.THREADS_ACCESS_TOKEN!;
  const userId = process.env.THREADS_USER_ID!;

  if (!accessToken || !userId) {
    return { success: false, error: 'Threads credentials not configured' };
  }

  try {
    // Step 1: Create media container
    const containerParams: Record<string, string> = {
      text: content,
      media_type: 'TEXT',
      access_token: accessToken,
    };

    if (mediaUrl) {
      if (/\.(mp4|mov|avi|webm)(\?|$)/i.test(mediaUrl)) {
        containerParams.media_type = 'VIDEO';
        containerParams.video_url = mediaUrl;
      } else {
        containerParams.media_type = 'IMAGE';
        containerParams.image_url = mediaUrl;
      }
    }

    const createUrl = 'https://graph.threads.net/v1.0/' + userId + '/threads';
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(containerParams).toString(),
    });

    if (!createResponse.ok) {
      const err = await createResponse.text();
      return { success: false, error: 'Threads container failed: ' + err };
    }

    const { id: containerId } = await createResponse.json();

    // Step 2: Publish
    const publishUrl = 'https://graph.threads.net/v1.0/' + userId + '/threads_publish';
    const publishResponse = await fetch(publishUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: containerId, access_token: accessToken }).toString(),
    });

    if (!publishResponse.ok) {
      const err = await publishResponse.text();
      return { success: false, error: 'Threads publish failed: ' + err };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: 'Threads error: ' + err };
  }
}