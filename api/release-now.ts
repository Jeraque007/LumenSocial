// Immediate post release endpoint
// POST /api/release-now with body { id: "post-id" }
// Publishes a single pending post immediately, bypassing its scheduled time.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Platform = 'linkedin' | 'facebook' | 'instagram' | 'youtube';

async function postToPlatform(platform: Platform, content: string, mediaUrl?: string, brand?: string) {
  switch (platform) {
    case 'linkedin': { const { postToLinkedin } = await import('../src/lib/connectors/linkedin'); return postToLinkedin(content, mediaUrl, brand); }
    case 'facebook': { const { postToFacebook } = await import('../src/lib/connectors/facebook'); return postToFacebook(content, mediaUrl, brand); }
    case 'instagram': { const { postToInstagram } = await import('../src/lib/connectors/instagram'); return postToInstagram(content, mediaUrl, brand); }
    // YouTube takes no brand routing - one channel per Google grant.
    case 'youtube': { const { postToYoutube } = await import('../src/lib/connectors/youtube'); return postToYoutube(content, mediaUrl); }
    default: return { success: false, error: 'Unsupported platform: ' + platform };
  }
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  // Auth check — same password used elsewhere in the app
  const authHeader = req.headers.get('authorization');
  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminPw && authHeader !== 'Bearer ' + adminPw) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  let id: string;
  try {
    const body = await req.json();
    id = body.id;
    if (!id) throw new Error('missing id');
  } catch {
    return new Response(JSON.stringify({ error: 'Request body must be JSON with an "id" field' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Fetch the post — must be pending status
  const { data: post, error: fetchError } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !post) {
    return new Response(JSON.stringify({ error: 'Post not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  if (post.status !== 'pending') {
    return new Response(JSON.stringify({ error: `Post status is "${post.status}" — only pending posts can be released immediately` }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  // Claim the post atomically — only the caller that flips pending → publishing may proceed,
  // so a concurrent cron/in-app scheduler run can never double-publish. If no row matched,
  // another run claimed it (or the status changed) between our fetch and this update.
  const { data: claimed, error: claimError } = await supabase.from('scheduled_posts')
    .update({ status: 'publishing', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (claimError) {
    return new Response(JSON.stringify({ error: 'Failed to claim post: ' + claimError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  if (!claimed || claimed.length === 0) {
    return new Response(JSON.stringify({ error: 'Post was already claimed by another release attempt (scheduled cron or background scheduler)' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  // Attempt to publish — up to 3 retries with exponential backoff, matching cron behaviour
  const mediaUrl = (post.video_url || post.media_url) ?? undefined;
  let result: { success: boolean; error?: string } = { success: false, error: 'Not attempted' };
  const maxRetries = 3;
  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        result = await postToPlatform(post.platform as Platform, post.content, mediaUrl, post.brand);
        if (result.success) break;
        // Don't retry auth errors — they won't self-resolve
        if (result.error && (result.error.includes('401') || result.error.includes('403') || result.error.includes('Unauthorized') || result.error.includes('invalid_grant'))) break;
      } catch (attemptError: unknown) {
        result = { success: false, error: 'Attempt ' + attempt + ' failed: ' + (attemptError instanceof Error ? attemptError.message : String(attemptError)) };
      }
      if (attempt < maxRetries && !result.success) await new Promise(r => setTimeout(r, attempt * 2000));
    }
  } catch (fatalError: unknown) {
    result = { success: false, error: 'Fatal error: ' + (fatalError instanceof Error ? fatalError.message : String(fatalError)) };
  }

  if (result.success) {
    await supabase.from('scheduled_posts')
      .update({ status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    return new Response(JSON.stringify({ success: true, platform: post.platform }), { headers: { 'Content-Type': 'application/json' } });
  } else {
    await supabase.from('scheduled_posts')
      .update({ status: 'failed', error_message: result.error || 'Release failed', updated_at: new Date().toISOString() })
      .eq('id', id);
    return new Response(JSON.stringify({ success: false, error: result.error }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export const config = { runtime: 'edge', maxDuration: 300 };
