// TEMPORARY diagnostic endpoint - safe to delete once the MyMarky workspace question is settled.
//
// WHAT THIS ANSWERS, AND WHY THE QUESTION CHANGED
//
// The pull now works: HOAWS imports 15 posts. The earlier "0 imported everywhere" was the edge
// runtime missing AbortSignal.timeout, which is fixed.
//
// S.A.E and Tessera are a different problem. MyMarky returns 60 posts for each, every one of them
// created 2026-07-26 (~70 days ago), with has_more: false and a limit cap of 100 (a limit of 500
// is rejected with 422). Paging, offset, page and sort are all ignored - they return byte-identical
// id lists. So there is no hidden second page. The configured workspace really is that stale.
//
// That leaves one question worth asking: is the new material in a DIFFERENT workspace under the
// same API key? This endpoint enumerates every workspace the key can see, ages the newest post in
// each, and compares them against the workspace the pull is configured to read.
//
// Auth: same ADMIN_PASSWORD as /api/auth-check. Never echoes the API key or any token.
const MYMARKY_API = 'https://api.mymarky.ai/api';

const BRANDS: Record<string, { key?: string; id?: string; fallback: string }> = {
  sae: { key: 'MYMARKY_API_KEY_SAE', id: 'MYMARKY_BUSINESS_ID_SAE', fallback: 'cd72203a-32bf-4832-9b72-6bb767b2da90' },
  tessera: { key: 'MYMARKY_API_KEY_TESSERA', id: 'MYMARKY_BUSINESS_ID_TESSERA', fallback: 'e2258821-9e9a-43b0-bff3-0e7419d6368a' },
  hoaws: { key: 'MYMARKY_API_KEY_HOAWS', id: 'MYMARKY_BUSINESS_ID_HOAWS', fallback: 'd36bd055-5dca-49e7-b1d4-2f218e6c051f' },
};

// RUNTIME MUST MATCH api/pull-mymarky.ts.
//
// This probe previously had no `config`, so Vercel ran it on Node.js while pull-mymarky.ts ran on
// the edge runtime - the probe therefore could NOT reproduce the pull's failure mode. Same runtime,
// same fetch, same result.
export const config = { runtime: 'edge', maxDuration: 60 };

// The statuses the pull will actually import. Anything else is released or not ready.
const IMPORTABLE = new Set(['NEW', 'DRAFT']);
// The pull's default since_days. The verdict quotes it so "nothing imported" is never ambiguous.
const WINDOW_DAYS = 30;
const PER_REQUEST_MS = 8000;
const MAX_WORKSPACES = 12;

type Json = any;

interface PostSummary {
  count: number;
  newestCreated: string | null;
  oldestCreated: string | null;
  newestAgeDays: number | null;
  statuses: Record<string, number>;
  // Posts that are NEW/DRAFT AND inside the window - exactly what the pull is allowed to take.
  importableNow: number;
}

interface WorkspaceRow extends PostSummary {
  id: string;
  name: string;
  configured: boolean;
  httpStatus?: number;
  error?: string;
}

// AbortController + setTimeout rather than AbortSignal.timeout(): this file runs on the edge
// runtime, where AbortSignal.timeout does not exist and throws. Same reasoning as the pull.
async function getJson(url: string, apiKey: string): Promise<{ status: number; body: Json; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_REQUEST_MS);
  try {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + apiKey }, signal: ctrl.signal });
    const text = await res.text();
    let body: Json = null;
    if (text) { try { body = JSON.parse(text); } catch { body = null; } }
    return { status: res.status, body, error: res.ok ? undefined : text.slice(0, 300) };
  } catch (e) {
    const aborted = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
    if (aborted) {
      return { status: 0, body: null, error: 'Timed out after ' + (PER_REQUEST_MS / 1000) + 's - MyMarky did not respond' };
    }
    return { status: 0, body: null, error: String(e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

// MyMarky has used `businesses`, `data` and a bare array in different places. Accept all three
// rather than guessing once and reporting "0 workspaces" because of a key name.
function pickList(body: Json): Json[] {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  const keys = ['businesses', 'data', 'items', 'results', 'rows'];
  for (const k of keys) {
    if (Array.isArray(body[k])) return body[k];
  }
  return [];
}

function analysePosts(items: Json[]): PostSummary {
  const statuses: Record<string, number> = {};
  const times: number[] = [];
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let importableNow = 0;

  for (const item of items) {
    const status = (item && item.status) || '(missing)';
    statuses[status] = (statuses[status] || 0) + 1;
    const raw = item && item.created_at;
    const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
    if (Number.isNaN(t)) continue;
    times.push(t);
    // The pull accepts NEW and DRAFT only, and only inside the window. Count what survives both
    // filters so the verdict can say "0 importable" as a fact rather than a guess.
    if (IMPORTABLE.has(String(status).toUpperCase()) && t >= cutoff) importableNow++;
  }

  const newest = times.length ? Math.max.apply(null, times) : null;
  const oldest = times.length ? Math.min.apply(null, times) : null;
  return {
    count: items.length,
    newestCreated: newest === null ? null : new Date(newest).toISOString(),
    oldestCreated: oldest === null ? null : new Date(oldest).toISOString(),
    newestAgeDays: newest === null ? null : Math.round(((Date.now() - newest) / 86400000) * 10) / 10,
    statuses: statuses,
    importableNow: importableNow,
  };
}


export default async function handler(req: Request) {
  // Wrapped so a 500 never hides the answer: report the real message and stack instead.
  try {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) return new Response('Server not configured', { status: 500 });
    const supplied = req.headers.get('x-admin-password');
    if (supplied !== adminPassword) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const slug = (new URL(req.url).searchParams.get('brand') || 'sae').toLowerCase();
    const brand = BRANDS[slug];
    if (!brand) return new Response(JSON.stringify({ error: 'Unknown brand: ' + slug }), { status: 400 });

    const apiKey = (brand.key ? (process.env[brand.key] || '') : '').trim();
    const businessId = (brand.id ? (process.env[brand.id] || '') : '').trim() || brand.fallback;
    if (!apiKey) return new Response(JSON.stringify({ error: 'No API key for ' + slug }), { status: 400 });

    const started = Date.now();

    // Two independent questions, asked together: what is in the workspace we read, and what other
    // workspaces does this key see? The second is the whole point of this run.
    const both = await Promise.all([
      getJson(MYMARKY_API + '/businesses/' + businessId + '/posts?limit=100', apiKey),
      getJson(MYMARKY_API + '/businesses?limit=100', apiKey),
    ]);
    const baselineRes = both[0];
    const bizRes = both[1];

    const baselineItems = pickList(baselineRes.body);
    const baseline = analysePosts(baselineItems);

    const rawBusinesses = pickList(bizRes.body)
      .filter(function (b: Json) { return b && (typeof b.id === 'string' || typeof b.business_id === 'string'); })
      .slice(0, MAX_WORKSPACES);

    // Age every workspace. The configured one already has its answer, so do not pay for it twice.
    const summaries: WorkspaceRow[] = await Promise.all(rawBusinesses.map(function (b: Json): Promise<WorkspaceRow> {
      const id = String(b.id || b.business_id);
      const name = String(b.name || b.business_name || b.label || '(unnamed)');
      const configured = id === businessId;
      if (configured) {
        return Promise.resolve({
          id: id, name: name, configured: true, httpStatus: baselineRes.status,
          count: baseline.count, newestCreated: baseline.newestCreated, oldestCreated: baseline.oldestCreated,
          newestAgeDays: baseline.newestAgeDays, statuses: baseline.statuses, importableNow: baseline.importableNow,
        });
      }
      return getJson(MYMARKY_API + '/businesses/' + id + '/posts?limit=100', apiKey).then(function (res) {
        if (res.error) {
          return {
            id: id, name: name, configured: false, httpStatus: res.status, error: res.error,
            count: 0, newestCreated: null, oldestCreated: null, newestAgeDays: null,
            statuses: {}, importableNow: 0,
          } as WorkspaceRow;
        }
        const a = analysePosts(pickList(res.body));
        return {
          id: id, name: name, configured: false, httpStatus: res.status,
          count: a.count, newestCreated: a.newestCreated, oldestCreated: a.oldestCreated,
          newestAgeDays: a.newestAgeDays, statuses: a.statuses, importableNow: a.importableNow,
        } as WorkspaceRow;
      });
    }));

    const foundRow = summaries.find(function (s) { return s.configured; });
    const configuredRow: WorkspaceRow = foundRow || {
      id: businessId, name: '(configured workspace)', configured: true, httpStatus: baselineRes.status,
      count: baseline.count, newestCreated: baseline.newestCreated, oldestCreated: baseline.oldestCreated,
      newestAgeDays: baseline.newestAgeDays, statuses: baseline.statuses, importableNow: baseline.importableNow,
    };


    // Freshest workspace by newest post, ignoring the ones we could not read.
    let freshest: WorkspaceRow | null = null;
    for (const s of summaries) {
      if (s.error || s.newestAgeDays === null) continue;
      if (!freshest || (s.newestAgeDays as number) < (freshest.newestAgeDays as number)) freshest = s;
    }
    let configuredInList = false;
    for (const s of summaries) { if (s.id === businessId) configuredInList = true; }

    // PLAIN ENGLISH - one sentence that decides what to do next.
    let verdict: string;
    if (baselineRes.error) {
      verdict = 'The baseline query failed (HTTP ' + baselineRes.status +
        '), so nothing can be concluded about this account. See the error under "configured workspace posts" below.';
    } else if (bizRes.error && summaries.length === 0) {
      verdict = 'Could not list workspaces (HTTP ' + bizRes.status +
        '), so we cannot tell whether the new material sits in a different one. The configured workspace holds ' +
        baseline.count + ' posts, newest ' + (baseline.newestAgeDays === null ? '?' : baseline.newestAgeDays) +
        ' days old, ' + baseline.importableNow + ' importable inside ' + WINDOW_DAYS + ' days. Error: ' + bizRes.error;
    } else if (configuredRow.newestAgeDays !== null
        && configuredRow.newestAgeDays <= WINDOW_DAYS
        && (!freshest || configuredRow.id === freshest.id
            || (configuredRow.newestAgeDays as number) <= (freshest.newestAgeDays as number))) {
      verdict = 'The configured workspace "' + configuredRow.name + '" has ' + configuredRow.count +
        ' posts, newest ' + configuredRow.newestAgeDays + ' days old, and ' + configuredRow.importableNow +
        ' of them are NEW/DRAFT inside the ' + WINDOW_DAYS +
        '-day window. MyMarky has the material - if the pull still imported nothing, the blocker is on our side (already-pulled ledger or status filter), not MyMarky.';
    } else if (freshest && freshest.id !== configuredRow.id
        && (freshest.newestAgeDays as number) <= WINDOW_DAYS) {
      verdict = 'FOUND IT. The pull reads workspace "' + configuredRow.name + '" (' + configuredRow.id +
        '), which holds ' + configuredRow.count + ' posts, newest ' +
        (configuredRow.newestAgeDays === null ? '?' : configuredRow.newestAgeDays) +
        ' days old - nothing inside the ' + WINDOW_DAYS + '-day window. But workspace "' + freshest.name +
        '" (' + freshest.id + ') under the SAME API key holds ' + freshest.count + ' posts, newest ' +
        freshest.newestAgeDays + ' days old, ' + freshest.importableNow + ' importable. Set MYMARKY_BUSINESS_ID_' +
        slug.toUpperCase() + ' to ' + freshest.id + ' and pull again.';
    } else if (!configuredInList && summaries.length > 0) {
      verdict = 'FOUND IT. The configured workspace id ' + businessId + ' is NOT among the ' + summaries.length +
        ' workspaces this API key can see. The key is pointed at a workspace it cannot read - re-check MYMARKY_BUSINESS_ID_' +
        slug.toUpperCase() + '.';
    } else {
      verdict = 'This API key sees ' + summaries.length + ' workspace(s) and none of them holds material newer than ' +
        WINDOW_DAYS + ' days. The freshest is "' + (freshest ? freshest.name : 'n/a') + '" at ' +
        (freshest ? freshest.newestAgeDays : '?') + ' days old. The new material is either in a different MyMarky account (a different API key) or was never pushed into MyMarky.';
    }


    // Rows for the existing table. Field names match what ApprovalQueue.tsx already renders:
    // query, httpStatus, returnedCount, hasMore, sampleDates[0].created_at.
    const baseKeys = (baselineRes.body && typeof baselineRes.body === 'object')
      ? Object.keys(baselineRes.body).filter(function (k) {
          return k.indexOf('cursor') !== -1 || k.indexOf('next') !== -1 || k === 'has_more';
        })
      : [];
    const results: Json[] = [
      {
        key: 'base',
        query: 'configured workspace posts (limit=100)',
        httpStatus: baselineRes.status,
        returnedCount: baseline.count,
        hasMore: baselineRes.body ? baselineRes.body.has_more : null,
        cursorFieldsPresent: baseKeys,
        nextRaw: baselineRes.body ? baselineRes.body.next_cursor : null,
        statuses: baseline.statuses,
        importableNow: baseline.importableNow,
        sampleDates: [{ id: businessId, created_at: baseline.newestCreated, note: 'newest of ' + baseline.count }],
        error: baselineRes.error,
      },
      {
        key: 'list',
        query: 'workspace list (GET /businesses)',
        httpStatus: bizRes.status,
        returnedCount: summaries.length,
        hasMore: null,
        cursorFieldsPresent: [],
        sampleDates: [],
        error: bizRes.error,
      },
    ];
    summaries.forEach(function (s, i) {
      results.push({
        key: 'ws' + i,
        query: 'workspace: ' + s.name + (s.configured ? ' (configured)' : ''),
        httpStatus: s.httpStatus === undefined ? null : s.httpStatus,
        returnedCount: s.count,
        hasMore: null,
        cursorFieldsPresent: [],
        statuses: s.statuses,
        importableNow: s.importableNow,
        sampleDates: [{ id: s.id, created_at: s.newestCreated, note: 'newest of ' + s.count }],
        error: s.error,
      });
    });

    const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
    const payload = {
      brand: slug,
      businessId: businessId,
      elapsedSec: elapsedSec,
      verdict: verdict,
      configuredWorkspace: configuredRow,
      workspaces: summaries,
      results: results,
    };
    return new Response(JSON.stringify(payload, null, 2), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    // Never fail opaquely: report the real message and stack.
    const err = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack.split('\n').slice(0, 6) : null;
    return new Response(JSON.stringify({ error: err, stack: stack }, null, 2), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

