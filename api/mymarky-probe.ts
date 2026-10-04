// TEMPORARY diagnostic endpoint - safe to delete once the MyMarky list shape is confirmed.
//
// Hits the MyMarky posts endpoint directly and reports the RAW shape of the response, plus the
// keys of the first post. This exists because the pull's own diagnostics could not distinguish
// "the account holds only these posts" from "we read one capped page and stopped" - both look
// identical (60 posts, no cursor). This endpoint answers it by showing what actually came back.
//
// Auth: same ADMIN_PASSWORD as /api/auth-check. Never echoes the API key or any token.
const MYMARKY_API = 'https://api.mymarky.ai/api';

const BRANDS: Record<string, { key?: string; id?: string; fallback: string }> = {
  sae: { key: 'MYMARKY_API_KEY_SAE', id: 'MYMARKY_BUSINESS_ID_SAE', fallback: '9a1b5ac9-007a-4018-8edf-8a21971ae049' },
  tessera: { key: 'MYMARKY_API_KEY_TESSERA', id: 'MYMARKY_BUSINESS_ID_TESSERA', fallback: '1ad527e6-b88b-43bb-a195-342ce3da1af6' },
  hoaws: { key: 'MYMARKY_API_KEY_HOAWS', id: 'MYMARKY_BUSINESS_ID_HOAWS', fallback: 'd36bd055-5dca-49e7-b1d4-2f218e6c051f' },
};

// RUNTIME MUST MATCH api/pull-mymarky.ts.
//
// This probe previously had no `config`, so Vercel ran it on Node.js while pull-mymarky.ts ran on
// the edge runtime - the probe therefore could NOT reproduce the pull's failure mode. That is
// exactly what happened: the pull failed on edge while the probe reported healthy, which sent the
// investigation in the wrong direction for hours. Same runtime, same fetch, same result.
export const config = { runtime: 'edge', maxDuration: 60 };

export default async function handler(req: Request) {
  // Everything is wrapped because a 500 tells us nothing: an unhandled throw returns Vercel's
  // own error page, not our JSON, so the UI shows an empty error and we learn nothing. This
  // reports the real message and stack instead.
  try {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) return new Response('Server not configured', { status: 500 });
    if (req.headers.get('x-admin-password') !== adminPassword) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const slug = (new URL(req.url).searchParams.get('brand') || 'sae').toLowerCase();
    const brand = BRANDS[slug];
    if (!brand) return new Response(JSON.stringify({ error: 'Unknown brand: ' + slug }), { status: 400 });

    const apiKey = (process.env[brand.key || ''] || '').trim();
    const businessId = (process.env[brand.id || ''] || '').trim() || brand.fallback;
    if (!apiKey) return new Response(JSON.stringify({ error: 'No API key for ' + slug }), { status: 400 });

    // EVERYTHING RUNS IN PARALLEL. Five sequential calls meant one slow MyMarky request stacked
    // behind the rest, and the whole check could not return for a minute or more. Parallel, the
    // slowest single call (~6s) sets the ceiling.
    const PER_REQUEST_MS = 6000;
    const TIMEOUT_ERR = 'Timed out after ' + (PER_REQUEST_MS / 1000) + 's - MyMarky did not respond';

    // Three possible explanations for "60 posts, all old, no cursor": a ?page= or ?offset= page
    // the pull never requests; a ?limit= larger than the cap; or genuinely nothing more in the
    // account. These three queries decide between them.
    const attempts = [
      { label: 'baseline - what the pull sends', qs: 'limit=100', key: 'base' },
      { label: 'page 2', qs: 'limit=100&page=2', key: 'page2' },
      { label: 'offset 60', qs: 'limit=100&offset=60', key: 'offset' },
      { label: 'limit 500', qs: 'limit=500', key: 'big' },
      { label: 'newest first', qs: 'limit=100&sort=-created_at', key: 'desc' },
    ];

    const started = Date.now();
    const results = await Promise.all(attempts.map(async (attempt) => {
      const url = MYMARKY_API + '/businesses/' + businessId + '/posts?' + attempt.qs;
      // AbortController + setTimeout instead of AbortSignal.timeout(). This repo's MyMarky
      // endpoints declare `runtime: 'edge'`, where AbortSignal.timeout is missing and throws;
      // using it here risks the probe being the very thing that fails. The catch below treats the
      // resulting AbortError the same way as a timeout, so the verdict still reads correctly.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PER_REQUEST_MS);
      try {
        const res = await fetch(url, {
          headers: { Authorization: 'Bearer ' + apiKey },
          signal: ctrl.signal,
        });
        const text = await res.text();
        let body: unknown;
        try { body = JSON.parse(text); } catch { body = null; }
        // A JSON array body is an object too, so check for that first or Object.keys() reports
        // meaningless numeric indices as the "top level keys".
        const obj: Record<string, unknown> =
          body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
        const items: unknown[] | null = Array.isArray(body) ? (body as unknown[])
          : Array.isArray(obj.items) ? (obj.items as unknown[])
          : Array.isArray(obj.data) ? (obj.data as unknown[])
          : null;
        // Entries may be null or non-objects; every read below assumes a real object.
        const firstItem = (items && items.length && items[0] && typeof items[0] === 'object')
          ? (items[0] as Record<string, unknown>) : null;
        const sampleDates = items
          ? items.slice(0, 3).map((p) => {
              const o = (p && typeof p === 'object') ? (p as Record<string, unknown>) : {};
              return {
                id: o.id ?? null,
                status: o.status ?? null,
                created_at: o.created_at ?? null,
                // Any other date-ish field, so a mis-named timestamp is visible.
                otherDates: Object.fromEntries(
                  Object.entries(o).filter(([k, v]) => /date|time|_at$/i.test(k) && k !== 'created_at' && typeof v !== 'object'),
                ),
              };
            })
          : null;

        // Post ids, so two pages can be compared for overlap - that is how we tell "page 2
        // exists and holds different posts" from "page 2 is a repeat of page 1".
        const ids = (items || [])
          .filter((p) => p && typeof p === 'object')
          .map((p) => String((p as Record<string, unknown>).id ?? ''));

        return {
          key: attempt.key,
          query: attempt.label,
          httpStatus: res.status,
          topLevelKeys: Array.isArray(body) ? ['(array body)'] : Object.keys(obj),
          returnedCount: items ? items.length : null,
          // Post ids so pages can be compared for overlap.
          ids,
          // The single most useful fact: what key holds the continuation cursor, if any.
          cursorFieldsPresent: Object.keys(obj).filter(k => /next|cursor|offset|page|has_?more/i.test(k)),
          hasMore: obj.has_more ?? obj.hasMore ?? null,
          nextRaw: typeof obj.next === 'string' ? obj.next.slice(0, 80)
            : obj.next ? JSON.stringify(obj.next).slice(0, 120) : null,
          // Field names on a post - reveals if the date is called something other than created_at,
          // which would make every post look ancient.
          postKeys: firstItem ? Object.keys(firstItem) : null,
          sampleDates,
          errorBodyPreview: res.ok ? null : text.slice(0, 300),
        };
      } catch (e) {
        // A timeout is the expected failure here, so name it plainly instead of surfacing the
        // raw "operation was aborted" message, which reads like a crash.
        const aborted = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        return {
          key: attempt.key,
          query: attempt.label,
          error: aborted ? TIMEOUT_ERR : (e instanceof Error ? e.message : String(e)).slice(0, 200),
          timedOut: aborted || undefined,
          ids: [] as string[],
        };
      } finally {
        // Without this the timer would outlive the request and hold the event loop.
        clearTimeout(timer);
      }
    }));

    // Index results by key so the verdict below can compare pages without repeating lookups.
    const byKey: Record<string, { returnedCount: number | null; ids: string[]; error?: string }> = {};
    for (const r of results) {
      byKey[r.key] = { returnedCount: r.returnedCount ?? null, ids: r.ids || [], error: r.error };
    }

    const base = byKey.base;
    const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
    const anyTimedOut = results.some(r => r.timedOut);

    // PLAIN ENGLISH. The whole point of this endpoint is to answer one question, so answer it in
    // one sentence instead of leaving anyone to interpret raw JSON.
    let verdict: string;
    const extra = results.find(r =>
      r.key !== 'base' && !r.error && (r.returnedCount || 0) > 0 &&
      (r.ids || []).some(id => !(base?.ids || []).includes(id)));

    if (anyTimedOut) {
      verdict = 'MyMarky did not answer within ' + (PER_REQUEST_MS / 1000) +
        ' seconds on at least one query. That is MyMarky being slow or unreachable, not a bug in LumenSocial. Try again in a minute.';
    } else if (!base || base.error || !base.returnedCount) {
      verdict = 'The baseline query failed, so nothing can be concluded about this account. See the error listed under "baseline".';
    } else if (extra) {
      verdict = 'FOUND IT. The pull only reads the first page: "' + extra.query + '" returned ' +
        extra.returnedCount + ' posts whose ids are NOT in the first ' + base.returnedCount +
        '. More material exists beyond what the pull fetches. Fix: follow that paging, or sort newest-first.';
    } else if ((byKey.big?.returnedCount || 0) > (base.returnedCount || 0)) {
      verdict = 'FOUND IT. A larger page size returns ' + byKey.big?.returnedCount +
        ' posts instead of ' + base.returnedCount + ', so the account holds more than the one page the pull reads.';
    } else {
      verdict = 'MyMarky returns ' + base.returnedCount + ' posts for this account on every query shape tried, with no further page. ' +
        'These are the real contents of the workspace - if none are recent, the account genuinely has no newer material in MyMarky.';
    }

    return new Response(JSON.stringify({ brand: slug, businessId, elapsedSec, verdict, results }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // The whole point: never fail opaquely again.
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? (e.stack || '').split('\n').slice(0, 6) : null,
    }, null, 2), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}