// Vercel Cron Job: Post Scheduler with retry logic
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Platform = 'linkedin' | 'facebook' | 'instagram' | 'youtube';

async function postToPlatform(platform: Platform, content: string, mediaUrl?: string, brand?: string) {
  switch (platform) {
    case 'linkedin': { const { postToLinkedin } = await import('../../src/lib/connectors/linkedin'); return postToLinkedin(content, mediaUrl, brand); }
    case 'facebook': { const { postToFacebook } = await import('../../src/lib/connectors/facebook'); return postToFacebook(content, mediaUrl, brand); }
    case 'instagram': { const { postToInstagram } = await import('../../src/lib/connectors/instagram'); return postToInstagram(content, mediaUrl, brand); }
    // YouTube takes no brand routing - it uploads to the single channel authorized by the Google
    // grant - and postToYoutube derives its title/description from `content` itself.
    case 'youtube': { const { postToYoutube } = await import('../../src/lib/connectors/youtube'); return postToYoutube(content, mediaUrl); }
    default: return { success: false, error: 'Unsupported platform: ' + platform };
  }
}

async function attemptPost(platform: Platform, content: string, mediaUrl?: string, brand?: string, maxRetries = 3): Promise<{ success: boolean; error?: string; attempts: number }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let result: { success: boolean; error?: string };
    try {
      result = await postToPlatform(platform, content, mediaUrl, brand);
    } catch (error: unknown) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (result.success) return { success: true, attempts: attempt };
    // Don't retry on auth errors (401/403) - those won't fix themselves
    if (result.error && (result.error.includes('401') || result.error.includes('403') || result.error.includes('Unauthorized') || result.error.includes('invalid_grant'))) {
      return { success: false, error: result.error, attempts: attempt };
    }
    if (attempt < maxRetries) {
      // Exponential backoff: 2s, 4s
      await new Promise(r => setTimeout(r, attempt * 2000));
    } else {
      return { success: false, error: result.error || 'Failed after ' + maxRetries + ' attempts', attempts: attempt };
    }
  }
  return { success: false, error: 'Max retries exceeded', attempts: maxRetries };
}

export default async function handler(req: Request) {
  // Vercel's daily cron sends the CRON_SECRET; the in-app scheduler ticker (Layout.tsx)
  // sends the admin password instead, so due posts still release within a minute when the
  // single daily Vercel run already fired or has not fired yet (Hobby plans run cron only
  // once per day, at an arbitrary minute within the scheduled hour). The admin password
  // grants nothing here that /api/release-now does not already grant.
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const authorized =
    (cronSecret && authHeader === 'Bearer ' + cronSecret) ||
    (adminPassword && authHeader === 'Bearer ' + adminPassword);
  if (!authorized) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = new Date().toISOString();
  const stalePublishingCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: duePosts, error: fetchError } = await supabase
    .from('scheduled_posts').select('*')
    .or(`status.eq.pending,and(status.eq.publishing,updated_at.lt.${stalePublishingCutoff})`)
    .lte('scheduled_at', now).order('scheduled_at', { ascending: true }).limit(20);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  if (!duePosts || duePosts.length === 0) {
    return new Response(JSON.stringify({ message: 'No posts due', processed: 0 }), { headers: { 'Content-Type': 'application/json' } });
  }

  const results = [];
  for (const post of duePosts) {
    // Claim the row by matching the exact status we just read (pending, or a stale publishing
    // row), so only one run wins and concurrent runs can never double-publish. Using the plain
    // status equality keeps the filter simple and avoids re-parsing the timestamp expression.
    const { data: claimed, error: claimError } = await supabase.from('scheduled_posts')
      .update({ status: 'publishing', updated_at: new Date().toISOString() })
      .eq('id', post.id)
      .eq('status', post.status)
      .select('id');
    if (claimError) {
      results.push({ id: post.id, platform: post.platform, success: false, error: 'Claim failed: ' + claimError.message, attempts: 0 });
      continue;
    }
    if (!claimed || claimed.length === 0) continue; // another run claimed this post first

    const mediaUrl = (post.video_url || post.media_url) ?? undefined;
    const result = await attemptPost(post.platform as Platform, post.content, mediaUrl, post.brand);

    if (result.success) {
      await supabase.from('scheduled_posts')
        .update({ status: 'published', published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', post.id);
    } else {
      await supabase.from('scheduled_posts')
        .update({ status: 'failed', error_message: result.error + ' (attempts: ' + result.attempts + ')', updated_at: new Date().toISOString() }).eq('id', post.id);
    }
    results.push({ id: post.id, platform: post.platform, ...result });
  }

  return new Response(JSON.stringify({ processed: results.length, results }), { headers: { 'Content-Type': 'application/json' } });
}

export const config = { runtime: 'edge', maxDuration: 300 };