// Pull posts from MyMarky -> scheduled_posts, one row per platform.
//
// THREE RULES, and that is the whole job:
//   1. Only import NEW material (status NEW or DRAFT, created within since_days).
//   2. Never import anything already pulled before - including material whose scheduled post has
//      since been deleted. Enforced by the mymarky_seen ledger (migration 009), which is written
//      on pull and NEVER deleted by the app.
//   3. Never import anything already released - a PUBLISHED/SCHEDULED MyMarky post is never ours,
//      and published rows in scheduled_posts keep blocking their content.
//
// MODES (?mode=)
//   fresh  (default) import only what rule 1 allows
//   force  re-import, ignoring rule 2 (creates duplicates; still respects rules 1 and 3)
//   reset  delete unpublished MyMarky rows first, then import. Published rows and the
//          mymarky_seen ledger are KEPT, so released and previously-pulled material stays blocked.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MYMARKY_API = 'https://api.mymarky.ai/api';

// MyMarky statuses, per their API:
//   NEW       = generated, awaiting review
//   DRAFT     = approved by a reviewer, but NOT published yet
//   SCHEDULED / PUBLISHED = released by MyMarky  -> never ours
//   REJECTED  = discarded                              -> never ours
//
// NEW and DRAFT are both unreleased, so both are eligible. Requiring NEW alone imported nothing at
// all: MyMarky moves generated posts to DRAFT on approval, and that is still fresh material.
// "Never pull released" is enforced below against SCHEDULED/PUBLISHED here AND against published
// rows in scheduled_posts.
const IMPORTABLE_STATUSES = new Set(['NEW', 'DRAFT']);

const BRANDS = [
  {
    name: 'S.A.E Method',
    apiKey: () => process.env.MYMARKY_API_KEY_SAE || '',
    businessId: () => process.env.MYMARKY_BUSINESS_ID_SAE || '9a1b5ac9-007a-4018-8edf-8a21971ae049',
    scheduleHour: 8,
  },
  {
    name: 'Tessera Lumen',
    apiKey: () => process.env.MYMARKY_API_KEY_TESSERA || '',
    businessId: () => process.env.MYMARKY_BUSINESS_ID_TESSERA || '1ad527e6-b88b-43bb-a195-342ce3da1af6',
    scheduleHour: 13,
  },
  {
    // scheduled_posts.brand must be exactly 'HOAWS' for the Facebook/Instagram/LinkedIn connectors
    // to route to the HOAWS_* credentials. Fallback mirrors .env.example so a missing env var
    // cannot silently disable the brand.
    name: 'HOAWS',
    apiKey: () => process.env.MYMARKY_API_KEY_HOAWS || '',
    businessId: () => process.env.MYMARKY_BUSINESS_ID_HOAWS || 'd36bd055-5dca-49e7-b1d4-2f218e6c051f',
    scheduleHour: 16,
  },
];

const PLATFORM_RULES: Record<string, { charLimit: number; maxImages: number }> = {
  linkedin: { charLimit: 3000, maxImages: 20 },
  facebook: { charLimit: 63206, maxImages: 3 },
  instagram: { charLimit: 2200, maxImages: 10 },
};
const PLATFORMS = Object.keys(PLATFORM_RULES);

interface MymarkyPost {
  id: string;
  status?: string;
  caption?: string;
  media_urls?: string[];
  created_at?: string;
}

interface BrandReport {
  brand: string;
  imported: number;
  skippedAlreadyPulled: number;
  skippedReleased: number;
  skippedTooOld: number;
  // How many posts MyMarky returned, broken down by status. Present whenever posts came back but
  // nothing was imported, so "0 imported" always has a visible reason instead of being silent.
  statusCounts?: Record<string, number>;
  // Age in days of the newest and oldest post MyMarky returned. This is the number that answers
  // "should I widen the window, or is there genuinely nothing new?" without a round trip.
  newestAgeDays?: number | null;
  oldestAgeDays?: number | null;
  // The exact workspace queried. If a brand reports old material while MyMarky clearly has newer
  // content, this is how you confirm the env var points at the right business.
  businessId?: string;
  businessIdFromEnv?: boolean;
  // How many posts MyMarky actually returned for this workspace. Compare across brands: a brand
  // returning far fewer rows than the others usually means the env var points at the wrong
  // workspace rather than that the workspace is empty.
  fetchedPosts?: number;
  // Pages actually fetched, and whether MyMarky offered a further page we did not read. If
  // hasMore is true the workspace holds material we never saw, which is how newer posts go
  // missing: we were reading a capped slice and calling it the whole account.
  pagesFetched?: number;
  hasMore?: boolean;
  // Which shape MyMarky returned its continuation cursor in: 'string', 'object', 'none' (last page),
  // or 'object-unusable'. Anything other than 'none' with hasMore=true means we stopped reading early.
  nextShape?: string;
  error?: string;
}

function trimCaption(caption: string, limit: number): string {
  if (!caption) return '';
  if (caption.length <= limit) return caption;
  const trimmed = caption.substring(0, limit - 1);
  const cut = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf('\n'));
  if (cut > limit * 0.5) return caption.substring(0, cut + 1);
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > limit * 0.5) return trimmed.substring(0, lastSpace) + '...';
  return trimmed + '...';
}

function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('giphy') || lower.includes('.mp4') || lower.includes('.mov') || lower.includes('video');
}

// Content fingerprint, brand-scoped. Catches the same caption reappearing under a NEW MyMarky
// post id - which happens whenever MyMarky regenerates rather than edits a post.
function signature(brand: string, content: string): string {
  return brand.toLowerCase() + '::' + content.trim().toLowerCase().slice(0, 300);
}

// Weekday slots are counted from `from`, so a brand continues filling the calendar from where its
// last post already sits. Starting from "today" every run made successive pulls target the same
// weekdays again, stacking two posts on the same day for the same platform.
function getNextWeekday(from: Date, offset: number): Date {
  const date = new Date(from);
  let added = 0;
  while (added < offset) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() >= 1 && date.getDay() <= 5) added++;
  }
  return date;
}

// PostgREST caps a plain select at 1000 rows, so page rather than silently truncating.
async function fetchAll<T>(table: string, columns: string, filterNotNull?: string): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let q = supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (filterNotNull) q = q.not(filterNotNull, 'is', null);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return rows;
}
export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('authorization') || '';
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || authHeader !== 'Bearer ' + adminPassword) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const url = new URL(req.url);
    const modeParam = url.searchParams.get('mode');
    const mode = modeParam === 'force' || modeParam === 'reset' ? modeParam : 'fresh';
    const force = mode === 'force';
    const reset = mode === 'reset';
    // Weekday slots to fill per brand.
    const maxPosts = Math.min(Math.max(parseInt(url.searchParams.get('days') || '5', 10) || 5, 1), 25);
    // How far back to accept material. Default 30 days; 0 disables the check.
    const sinceDaysRaw = parseInt(url.searchParams.get('since_days') ?? '', 10);
    const sinceDays = Number.isFinite(sinceDaysRaw) && sinceDaysRaw >= 0 ? Math.min(sinceDaysRaw, 365) : 30;
    const cutoff = sinceDays > 0 ? Date.now() - sinceDays * 24 * 60 * 60 * 1000 : 0;

    const reports: BrandReport[] = [];
    let totalImported = 0;

    // Reset: clear unpublished MyMarky rows so our own backlog stops blocking rule 2.
    // Published rows stay (they are rule 3's memory) and mymarky_seen is never touched.
    if (reset) {
      const { data, error } = await supabase
        .from('scheduled_posts')
        .select('id')
        .not('mymarky_id', 'is', null)
        .in('status', ['draft', 'pending', 'failed']);
      if (error) throw new Error('reset failed: ' + error.message);
      const ids = (data || []).map(r => r.id as string);
      if (ids.length > 0) {
        const { error: delErr } = await supabase.from('scheduled_posts').delete().in('id', ids);
        if (delErr) throw new Error('reset delete failed: ' + delErr.message);
      }
    }

    // RULE 2 memory: every MyMarky post ever pulled, per brand. Survives deletion of the
    // scheduled post, so deleted material is never re-imported.
    const seenRows = await fetchAll<{ mymarky_id: string; brand: string; signature: string }>(
      'mymarky_seen', 'mymarky_id, brand, signature'
    );
    const seenIds = new Set(seenRows.map(r => r.mymarky_id));
    const seenSigs = new Set(seenRows.map(r => r.signature));

    // RULE 3, independent of the ledger: anything already RELEASED stays blocked even if the
    // mymarky_seen ledger has been cleared. The ledger alone is not enough - clearing it (which the
    // recovery SQL does) would otherwise make already-published material importable again.
    const { data: released } = await supabase
      .from('scheduled_posts')
      .select('brand, content')
      .eq('status', 'published');
    const releasedSigs = new Set(
      (released || []).map(r => signature(r.brand || '', r.content || ''))
    );

    // Material sitting in the approval queue as a DRAFT (awaiting Approve All) blocks itself too.
    // Read straight from scheduled_posts rather than relying on the ledger alone, so a pull cannot
    // re-import a post that is already sitting there unapproved - which is what "select 5 days at a
    // time and it re-imports" looked like.
    const { data: queued } = await supabase
      .from('scheduled_posts')
      .select('brand, content')
      .in('status', ['draft', 'pending', 'failed']);
    const queuedSigs = new Set(
      (queued || []).map(r => signature(r.brand || '', r.content || ''))
    );

    // Where each brand's calendar currently ends, so a new pull continues after it instead of
    // restarting at next Monday and stacking a second post on the same weekday.
    const latestByBrand = new Map<string, number>();
    const { data: pending } = await supabase
      .from('scheduled_posts')
      .select('brand, scheduled_at')
      .in('status', ['draft', 'pending']);
    for (const row of pending || []) {
      const b = row.brand as string | null;
      const t = Date.parse(row.scheduled_at as string);
      if (!b || Number.isNaN(t)) continue;
      const prev = latestByBrand.get(b);
      if (prev === undefined || t > prev) latestByBrand.set(b, t);
    }

    for (const brand of BRANDS) {
      const report: BrandReport = {
        brand: brand.name,
        imported: 0,
        skippedAlreadyPulled: 0,
        skippedReleased: 0,
        skippedTooOld: 0,
      };
      reports.push(report);

      const apiKey = brand.apiKey();
      const businessId = brand.businessId();
      // Echo the workspace actually queried, and whether it came from env or the built-in
      // fallback. A wrong business_id looks exactly like "no new material", so this must be
      // visible in the report rather than inferred.
      report.businessId = businessId || '(none)';
      report.businessIdFromEnv = !!businessId;
      if (!apiKey || !businessId) {
        report.error = apiKey ? 'Business ID not configured' : 'API key not configured';
        continue;
      }

      // Fetch WITHOUT a status filter and filter locally below. Passing status=NEW&status=DRAFT made
      // this endpoint return zero posts for every brand even though the accounts hold plenty -
      // the repeated query param is not reliably honoured, and an empty result is indistinguishable
      // from an empty account. Filtering client-side cannot fail that way.
      //
      // Paged via `next` cursor rather than one big limit: MyMarky caps a page, and a single page
      // returned only 60 rows where more exist - which would silently hide newer material and make
      // a brand look stale. Follow the cursor so we see everything the account actually holds.
      const collected: MymarkyPost[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (let page = 0; page < 25; page++) {
        const url = MYMARKY_API + '/businesses/' + businessId + '/posts?limit=100' +
          (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + apiKey } });
        if (!res.ok) {
          report.error = 'MyMarky API ' + res.status;
          break;
        }
        const pageBody = await res.json();
        const pagePosts: MymarkyPost[] = Array.isArray(pageBody?.items) ? pageBody.items
          : Array.isArray(pageBody?.data) ? pageBody.data
          : Array.isArray(pageBody) ? pageBody
          : [];
        collected.push(...pagePosts);
        pages++;
        // Guard against a cursor that repeats: without this, a non-advancing cursor would spin
        // the same page 25 times and pad the result with duplicates.
        // `next` is documented as a bare cursor string, but if the API ever returns it as an object
        // ({cursor: '...'}) or under an alias, a string-only check silently yields undefined and the
        // loop stops after page 1 - which looks identical to "the account only holds this many
        // posts". Accept every plausible shape and report which one arrived, so a truncated read is
        // visible in the diagnostics instead of being mistaken for an empty account.
        const rawNext = pageBody?.next ?? pageBody?.cursor ?? null;
        let nextCursor: string | undefined;
        if (typeof rawNext === 'string' && rawNext) {
          nextCursor = rawNext;
          report.nextShape = 'string';
        } else if (rawNext && typeof rawNext === 'object') {
          const inner = (rawNext as Record<string, unknown>).cursor ?? (rawNext as Record<string, unknown>).token;
          if (typeof inner === 'string' && inner) {
            nextCursor = inner;
            report.nextShape = 'object';
          } else {
            report.nextShape = 'object-unusable';
          }
        }
        if (report.nextShape === undefined) report.nextShape = 'none';
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
        if (pagePosts.length === 0) break;
      }
      const posts: MymarkyPost[] = collected;
      report.fetchedPosts = posts.length;
      report.pagesFetched = pages;
      report.hasMore = cursor !== undefined;
      if (posts.length === 0) {
        report.error = 'MyMarky returned 0 posts for this business';
        continue;
      }

      // Newest first, so the freshest material wins the limited slots.
      posts.sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''));

      // Age of the newest/oldest post in this account. Reported on every brand so "nothing was
      // imported" is always answerable: a small newestAgeDays means widen the window, a large one
      // means the account genuinely has no recent material.
      const ages = posts
        .map(p => (p.created_at ? Date.parse(p.created_at) : NaN))
        .filter(t => !Number.isNaN(t))
        .map(t => Math.round(((Date.now() - t) / (24 * 60 * 60 * 1000)) * 10) / 10);
      report.newestAgeDays = ages.length ? Math.min(...ages) : null;
      report.oldestAgeDays = ages.length ? Math.max(...ages) : null;

      let slots = 0;
      for (const post of posts) {
        if (slots >= maxPosts) break;
        // RULE 3: anything MyMarky considers released is never ours to publish.
        if (!IMPORTABLE_STATUSES.has(post.status || '')) {
          report.skippedReleased++;
          continue;
        }
        if (cutoff > 0 && Date.parse(post.created_at || '') < cutoff) {
          report.skippedTooOld++;
          continue;
        }
        // RULE 2: already pulled before, even if the scheduled rows were since deleted.
        if (!force && seenIds.has(post.id)) {
          report.skippedAlreadyPulled++;
          continue;
        }

        const caption = post.caption || '';
        if (!caption && !(post.media_urls || []).length) continue;
        const media = post.media_urls || [];
        const video = media.find(isVideoUrl) || null;
        const images = media.filter((u: string) => !isVideoUrl(u));

        // RULE 2, content level: the same caption arriving under a DIFFERENT MyMarky id is still
        // the same material. This is checked ONCE per post, never per platform.
        //
        // It must not be checked inside the platform loop: every platform shares one caption, so
        // adding the signature after the first platform would make facebook and instagram look
        // like duplicates of linkedin and skip them. That bug pulled LinkedIn only.
        const postSig = signature(brand.name, caption);
        if (!force && seenSigs.has(postSig)) {
          report.skippedAlreadyPulled++;
          continue;
        }
        // Already released - never re-import, whatever the ledger says.
        if (!force && releasedSigs.has(postSig)) {
          report.skippedReleased++;
          continue;
        }
        // Already sitting in the approval queue unapproved - do not re-import a second copy.
        if (!force && queuedSigs.has(postSig)) {
          report.skippedAlreadyPulled++;
          continue;
        }

        // Continue after this brand's last scheduled post rather than restarting from today, otherwise
      // a second pull targets the same weekdays again and stacks a duplicate post per platform.
      const scheduleStart = latestByBrand.get(brand.name);
      const scheduleDate = getNextWeekday(
        scheduleStart !== undefined ? new Date(scheduleStart) : new Date(),
        slots + 1
      );
        scheduleDate.setUTCHours(brand.scheduleHour, 0, 0, 0);

        let insertedAny = false;
        for (const platform of PLATFORMS) {
          const rules = PLATFORM_RULES[platform];
          const content = trimCaption(caption, rules.charLimit);
          const imgs = images.slice(0, rules.maxImages);

          const { error } = await supabase.from('scheduled_posts').insert({
            content,
            media_url: video || imgs[0] || null,
            media_urls: JSON.stringify(imgs),
            video_url: video,
            platform,
            scheduled_at: scheduleDate.toISOString(),
            status: 'draft',
            brand: brand.name,
            pillar: null,
            mymarky_id: post.id + '_' + platform,
          });
          if (error) {
            report.error = report.error || (platform + ': ' + error.message);
            continue;
          }

          report.imported++;
          totalImported++;
          insertedAny = true;
        }

        if (insertedAny) {
          // Record the source post so it is never pulled again, even if its scheduled rows are deleted.
          await supabase.from('mymarky_seen').upsert(
            { mymarky_id: post.id, brand: brand.name, signature: postSig },
            { onConflict: 'mymarky_id,brand' }
          );
          seenIds.add(post.id);
          seenSigs.add(postSig);
          slots++;
        }
      }

      // If posts came back but none were imported, show what statuses they actually held. This is
      // what makes a "0 imported" brand explainable instead of a mystery.
      if (report.imported === 0 && posts.length > 0) {
        const counts: Record<string, number> = {};
        for (const p of posts) {
          const key = p.status || '(missing)';
          counts[key] = (counts[key] || 0) + 1;
        }
        report.statusCounts = counts;
        report.error = report.error || (
          'nothing imported from ' + posts.length + ' posts; newest is ' +
          (report.newestAgeDays ?? '?') + ' days old, window is ' + sinceDays +
          ' days (statuses: ' + Object.entries(counts).map(([k, v]) => k + '=' + v).join(', ') + ')' +
          (report.hasMore ? ' [MORE PAGES EXIST THAT WERE NOT READ]' : '')
        );
      }
    }

    return new Response(JSON.stringify({
      success: true,
      imported: totalImported,
      mode,
      since_days: sinceDays,
      brands: reports,
      message: 'Imported ' + totalImported + ' platform posts',
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: 'Server error: ' + ((err as Error)?.message || err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export const config = { runtime: 'edge' };
