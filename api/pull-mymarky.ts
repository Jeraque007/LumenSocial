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
//   reset  delete unpublished MyMarky rows and clear the mymarky_seen ledger first, then import.
//          Published rows are KEPT, so rule 3 still blocks anything already released.
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
    // 2026-10-04: replaced 9a1b5ac9-... . The old id still answers /businesses/{id}/posts, but only
    // with a 60-post batch created 2026-07-26 and nothing since - while the live workspace with 60
    // importable posts a week old sits under this id on the SAME API key. resolveWorkspace() below
    // catches this case automatically, so the fallback matters mainly for the report.
    businessId: () => process.env.MYMARKY_BUSINESS_ID_SAE || 'cd72203a-32bf-4832-9b72-6bb767b2da90',
    scheduleHour: 8,
    // Only S.A.E Method has a YouTube channel wired up today. HOAWS and Tessera do NOT, so they
    // are false below - creating youtube rows for them would only produce failures. Set a brand
    // to true once its channel exists; nothing else in the pull needs to change.
    youtube: true,
  },
  {
    name: 'Tessera Lumen',
    apiKey: () => process.env.MYMARKY_API_KEY_TESSERA || '',
    // 2026-10-04: replaced 1ad527e6-... for the same reason as S.A.E above.
    businessId: () => process.env.MYMARKY_BUSINESS_ID_TESSERA || 'e2258821-9e9a-43b0-bff3-0e7419d6368a',
    scheduleHour: 13,
    youtube: false,
  },
  {
    // scheduled_posts.brand must be exactly 'HOAWS' for the Facebook/Instagram/LinkedIn connectors
    // to route to the HOAWS_* credentials. Fallback mirrors .env.example so a missing env var
    // cannot silently disable the brand.
    name: 'HOAWS',
    apiKey: () => process.env.MYMARKY_API_KEY_HOAWS || '',
    businessId: () => process.env.MYMARKY_BUSINESS_ID_HOAWS || 'd36bd055-5dca-49e7-b1d4-2f218e6c051f',
    scheduleHour: 16,
    youtube: false,
  },
];

const PLATFORM_RULES: Record<string, { charLimit: number; maxImages: number }> = {
  linkedin: { charLimit: 3000, maxImages: 20 },
  facebook: { charLimit: 63206, maxImages: 3 },
  instagram: { charLimit: 2200, maxImages: 10 },
  // YouTube: video only, no images (maxImages 0), description cap 5000 characters. The pull skips
  // this platform entirely when the source post has no video - see the guard in the loop below.
  youtube: { charLimit: 5000, maxImages: 0 },
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
  // Set only when the configured workspace had nothing importable while another workspace under the
  // same API key did. Names both, so a workspace switch can never be mistaken for "the env var was
  // right all along".
  workspaceSwitchedFrom?: string;
  workspaceName?: string;
  // How many posts rule 1 would accept from the workspace actually read. 0 here with a non-zero
  // fetchedPosts means the window or the statuses rejected everything - not that MyMarky was empty.
  importableInWindow?: number;
  // The exact weekdays this run wrote to, in order. "I asked for 5 days" is unanswerable from an
  // imported count alone - this is where the posts actually landed.
  placedOn?: string[];
  // Slots refused because the brand already had content on that day. Non-zero means the pull
  // stepped over a day it would previously have duplicated onto.
  steppedOverUsedDays?: number;
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
  // How pagination was achieved: 'cursor', 'offset' (MyMarky sent no cursor, so we walked slices
  // by offset), or 'none' (a single page held everything).
  pagedBy?: string;
  // True only when we hit the 10-page ceiling, i.e. there may be more beyond what we read.
  stoppedEarly?: boolean;
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

// Portable timeout for an outbound fetch.
//
// THIS EXISTS BECAUSE AbortSignal.timeout() IS NOT AVAILABLE IN THE RUNTIME THIS FILE RUNS ON.
// pull-mymarky.ts declares `runtime: 'edge'`, where AbortSignal.timeout is missing: calling it
// throws a TypeError, my catch turned that into res = null, and the loop then reported
// "MyMarky returned 0 posts for this business" for ALL THREE BRANDS - i.e. nothing imported on
// fresh, force or reset, at any window size. It was added in commit 44edce4 and nothing has
// imported since. AbortController + setTimeout is supported everywhere, so use that instead.
async function fetchWithTimeout(url: string, headers: Record<string, string>, ms: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { headers, signal: ctrl.signal });
  } catch {
    // A timeout or network failure. Returning null keeps the caller's distinction between
    // "first request failed - report it" and "a later page failed - keep what we already have".
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Workspace resolution -------------------------------------------------
//
// A MyMarky business id can outlive the workspace it points at.
//
// On 2026-10-04 both S.A.E and Tessera were importing nothing but 70-day-old material while holding
// 60 importable posts a week old. The configured ids (9a1b5ac9-... and 1ad527e6-...) still answer
// /businesses/{id}/posts - they just answer with a single bulk batch created 2026-07-26 and
// nothing since. The live workspaces sit under DIFFERENT ids under the SAME API key. From inside
// LumenSocial that is indistinguishable from "the account has no new material", which is exactly
// what these two brands reported for weeks.
//
// So never trust an id just because it was configured. Read it first; only if it holds nothing we
// could import do we ask which other workspaces the key can see. An id that works costs one extra
// request (the HOAWS case); an id that has gone stale gets corrected instead of silently ignored.

function extractPosts(body: unknown): MymarkyPost[] {
  if (!body) return [];
  if (Array.isArray(body)) return body as MymarkyPost[];
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.items)) return b.items as MymarkyPost[];
  if (Array.isArray(b.data)) return b.data as MymarkyPost[];
  return [];
}

function pickArray(body: unknown, keys: string[]): any[] {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  const b = body as Record<string, unknown>;
  for (const k of keys) if (Array.isArray(b[k])) return b[k] as any[];
  return [];
}

function newestCreatedMs(posts: MymarkyPost[]): number {
  let max = 0;
  for (const p of posts) {
    const t = Date.parse((p && p.created_at) || '');
    if (!Number.isNaN(t) && t > max) max = t;
  }
  return max;
}

// How many posts rule 1 would accept from this workspace. 0 means the pull could import nothing
// from it, whatever else the workspace holds - which is the whole test for "is this the right id".
function importableInWindow(posts: MymarkyPost[], cutoff: number): number {
  let n = 0;
  for (const p of posts) {
    if (!p || !IMPORTABLE_STATUSES.has(p.status || '')) continue;
    const t = Date.parse(p.created_at || '');
    if (Number.isNaN(t)) continue;
    if (cutoff > 0 && t < cutoff) continue;
    n++;
  }
  return n;
}

interface WorkspaceChoice {
  id: string;
  name?: string;
  // The id we started from and abandoned. Present only when a switch actually happened.
  switchedFrom?: string;
  importable: number;
}

async function resolveWorkspace(apiKey: string, configuredId: string, cutoff: number): Promise<WorkspaceChoice> {
  const headers = { Authorization: 'Bearer ' + apiKey };

  // Step 1: does the configured workspace still hold anything we could import? If yes, stop here -
  // this is the happy path and must not change behaviour for a brand that is already working.
  const first = await fetchWithTimeout(
    MYMARKY_API + '/businesses/' + configuredId + '/posts?limit=100', headers, 20000
  );
  if (first && first.ok) {
    const body = await first.json().catch(() => null);
    const n = importableInWindow(extractPosts(body), cutoff);
    if (n > 0) return { id: configuredId, importable: n };
  }

  // Step 2: stale or unreadable. Ask which workspaces this key can see and pick the one that would
  // actually import. Kept deliberately conservative - a candidate must hold importable posts, and
  // ties go to the workspace with the newest material.
  const listRes = await fetchWithTimeout(MYMARKY_API + '/businesses?limit=100', headers, 20000);
  if (!listRes || !listRes.ok) return { id: configuredId, importable: 0 };

  const listBody = await listRes.json().catch(() => null);
  const candidates = pickArray(listBody, ['businesses', 'data', 'items', 'results', 'rows'])
    .filter((b: any) => b && (typeof b.id === 'string' || typeof b.business_id === 'string'))
    .slice(0, 12);

  const scored = await Promise.all(
    candidates.map(async (b: any) => {
      const id = String(b.id || b.business_id);
      if (id === configuredId) return null;
      const res = await fetchWithTimeout(
        MYMARKY_API + '/businesses/' + id + '/posts?limit=100', headers, 20000
      );
      if (!res || !res.ok) return null;
      const posts = extractPosts(await res.json().catch(() => null));
      return {
        id,
        name: typeof b.name === 'string' ? b.name : '',
        count: importableInWindow(posts, cutoff),
        newest: newestCreatedMs(posts),
      };
    })
  );

  let best: { id: string; name: string; count: number; newest: number } | null = null;
  for (const c of scored) {
    if (!c || c.count <= 0) continue;
    if (!best || c.count > best.count || (c.count === best.count && c.newest > best.newest)) best = c;
  }
  if (!best) return { id: configuredId, importable: 0 };
  return { id: best.id, name: best.name || '(unnamed)', switchedFrom: configuredId, importable: best.count };
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

    // Reset: clear unpublished MyMarky rows AND the already-pulled ledger.
    //
    // This used to leave mymarky_seen untouched, which made `reset` a permanent no-op: the rows
    // were deleted, but every source post was still recorded in the ledger, so rule 2 skipped all
    // of them and the pull imported nothing - no matter whether the window was 5, 7 or 25 days.
    // Deleting the rows only ever freed `queuedSigs`, never `seenIds`.
    //
    // Published rows are NOT deleted, so `releasedSigs` still blocks anything already released -
    // rule 3 survives the reset. That is the protection worth keeping, and it does not depend on
    // the ledger.
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
      const { error: ledgerErr } = await supabase.from('mymarky_seen').delete().neq('id', 0);
      if (ledgerErr) throw new Error('reset ledger clear failed: ' + ledgerErr.message);
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
    // restarting at today and stacking a second post on a weekday that already went out.
    //
    // THIS USED TO FILTER TO draft/pending ONLY. Published rows therefore did not count, and a day
    // that had already been posted to looked EMPTY: once a brand's week of drafts had all been
    // released the map came back without that brand, `scheduleStart` fell back to `new Date()`, and
    // the next pull re-plotted from today straight onto weekdays that were already live on the
    // social networks - the "duplicate on Monday 5th, already posted" report. Every status means the
    // calendar is occupied there, so no status is filtered out.
    const latestByBrand = new Map<string, number>();
    // Per brand, every YYYY-MM-DD that already carries content. `latest` alone is not enough: a brand
    // can hold an old published day with no later row, and then nothing points at the blocked day.
    const usedDays = new Map<string, Set<string>>();
    const { data: existingRows } = await supabase
      .from('scheduled_posts')
      .select('brand, scheduled_at, status');
    for (const row of existingRows || []) {
      const b = row.brand as string | null;
      const t = Date.parse(row.scheduled_at as string);
      if (!b || Number.isNaN(t)) continue;
      const prev = latestByBrand.get(b);
      if (prev === undefined || t > prev) latestByBrand.set(b, t);
      const day = String(row.scheduled_at).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      let set = usedDays.get(b);
      if (!set) { set = new Set<string>(); usedDays.set(b, set); }
      set.add(day);
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
      const configuredId = brand.businessId();
      // Echo the workspace actually queried, and whether it came from env or the built-in
      // fallback. A wrong business_id looks exactly like "no new material", so this must be
      // visible in the report rather than inferred.
      report.businessId = configuredId || '(none)';
      report.businessIdFromEnv = !!configuredId;
      if (!apiKey || !configuredId) {
        report.error = apiKey ? 'Business ID not configured' : 'API key not configured';
        continue;
      }

      // A configured id can silently point at a workspace that no longer holds anything importable
      // while the live workspace sits under a different id on the same key. resolveWorkspace reads
      // the configured id first and only goes looking when it comes back empty - see the note above
      // its definition for why this cannot be left to configuration.
      const choice = await resolveWorkspace(apiKey, configuredId, cutoff);
      const businessId = choice.id;
      report.businessId = businessId;
      report.importableInWindow = choice.importable;
      if (choice.switchedFrom) {
        report.workspaceSwitchedFrom = choice.switchedFrom;
        report.workspaceName = choice.name || '(unnamed)';
      }

      // Fetch WITHOUT a status filter and filter locally below. Passing status=NEW&status=DRAFT made
      // this endpoint return zero posts for every brand even though the accounts hold plenty - the
      // repeated query param is not reliably honoured, and an empty result is indistinguishable
      // from an empty account. Filtering client-side cannot fail that way.
      //
      // MyMarky caps a page below the requested limit (asked for 100, got 60) and sends no cursor,
      // so a cursor-only loop stops after page 1 and silently hides everything beyond it - which
      // makes an account look stale when it is not. So: follow the cursor when there is one, and
      // otherwise try an offset page once and keep going only while it yields posts we have not
      // seen. If the API rejects `offset` or repeats itself, `fresh` hits 0 and we stop - this
      // cannot fail a pull that was already working, it can only find more.
      const collected: MymarkyPost[] = [];
      const seenPostIds = new Set<string>();
      let cursor: string | undefined;
      let offset = 0;
      let pages = 0;
      let pagedBy = 'none';
      let stoppedEarly = false;

      const absorb = (batch: MymarkyPost[]): number => {
        let fresh = 0;
        for (const p of batch) {
          const pid = p && typeof p === 'object' ? p.id : undefined;
          if (!pid || seenPostIds.has(pid)) continue;
          seenPostIds.add(pid);
          collected.push(p);
          fresh++;
        }
        return fresh;
      };

      for (let page = 0; page < 10; page++) {
        const qs = 'limit=100' +
          (cursor ? '&cursor=' + encodeURIComponent(cursor) : '') +
          (!cursor && page > 0 ? '&offset=' + offset : '');
        const url = MYMARKY_API + '/businesses/' + businessId + '/posts?' + qs;
        // fetchWithTimeout, not AbortSignal.timeout: this file runs on the edge runtime, where
        // AbortSignal.timeout does not exist and throws - which turned into "0 posts" for every brand.
        const res = await fetchWithTimeout(url, { Authorization: 'Bearer ' + apiKey }, 20000);
        if (!res || !res.ok) {
          // Only the FIRST request failing is a real error. A later page being rejected just means
          // this API does not support that paging style, and the posts already collected stand.
          if (page === 0) report.error = res ? 'MyMarky API ' + res.status : 'MyMarky unreachable';
          break;
        }
        const pageBody = await res.json().catch(() => null);
        const pagePosts: MymarkyPost[] = Array.isArray(pageBody?.items) ? pageBody.items
          : Array.isArray(pageBody?.data) ? pageBody.data
          : Array.isArray(pageBody) ? pageBody
          : [];
        const fresh = absorb(pagePosts);
        pages++;

        // `next` may be a bare string, an object, or under an alias; a string-only check would
        // silently stop after page 1. Report which shape arrived so a truncated read is visible.
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

        if (nextCursor && nextCursor !== cursor) {
          pagedBy = 'cursor';
          cursor = nextCursor;
          if (fresh === 0) break; // repeat page guard
          continue;
        }

        // No cursor. Stop if this page produced nothing new, otherwise ask for the next slice.
        if (fresh === 0) break;
        offset = collected.length;
        pagedBy = offset > 0 ? 'offset' : 'none';
        if (page === 9) stoppedEarly = true;
      }
      report.pagedBy = pagedBy;
      report.stoppedEarly = stoppedEarly || undefined;

      const posts: MymarkyPost[] = collected;
      report.fetchedPosts = posts.length;
      report.pagesFetched = pages;
      report.hasMore = stoppedEarly;
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
      const alreadyUsed = usedDays.get(brand.name) || new Set<string>();
      usedDays.set(brand.name, alreadyUsed);
      let scheduleDate = getNextWeekday(
        scheduleStart !== undefined ? new Date(scheduleStart) : new Date(),
        slots + 1
      );
      // Step over any day this brand already has content on. `latest` above usually lands clear of
      // them, but when it does not - an old published day, or a gap in the calendar - falling back
      // would put fresh material on a weekday that already went out. 60 is a hard stop so a
      // pathological calendar can never spin here.
      let stepped = false;
      for (let guard = 0; guard < 60; guard++) {
        scheduleDate.setUTCHours(brand.scheduleHour, 0, 0, 0);
        const day = scheduleDate.toISOString().slice(0, 10);
        if (!alreadyUsed.has(day)) break;
        stepped = true;
        scheduleDate = getNextWeekday(scheduleDate, 1);
      }
      if (stepped) report.steppedOverUsedDays = (report.steppedOverUsedDays || 0) + 1;
      // Reserve it, so the next slot of this same pull cannot land here too.
      alreadyUsed.add(scheduleDate.toISOString().slice(0, 10));
      report.placedOn = report.placedOn || [];
      report.placedOn.push(scheduleDate.toISOString());

        let insertedAny = false;
        for (const platform of PLATFORMS) {
          // YouTube cannot publish a still image, so an image-only source post must not produce a
          // youtube row - it would sit in the queue and fail on release every time.
          if (platform === 'youtube' && !video) continue;
          // Only brands that actually own a YouTube channel get a row. Right now that is S.A.E
          // Method alone - HOAWS has no channel yet, and a row for it would just fail on release.
          if (platform === 'youtube' && !brand.youtube) continue;
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
      // Echoed so "I asked for 5 days" can be checked against what came back rather than inferred
      // from the imported count. `days` is the weekday-slot budget per brand, not a date range.
      requestedDays: maxPosts,
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

// maxDuration: 60 matches api/mymarky-probe.ts. resolveWorkspace() may read several workspaces
// when a business id has gone stale, and a pull must not be cut off mid-brand because of it.
export const config = { runtime: 'edge', maxDuration: 60 };
