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

    // Try several query shapes. If one returns more posts, or a cursor the normal pull ignores,
    // that difference is the bug.
    const attempts = [
      { label: 'limit=100 (what the pull uses)', qs: 'limit=100' },
      { label: 'limit=100&status=NEW', qs: 'limit=100&status=NEW' },
      { label: 'limit=100&sort=-created_at', qs: 'limit=100&sort=-created_at' },
      { label: 'limit=100&order=desc', qs: 'limit=100&order=desc' },
      { label: 'no params', qs: '' },
    ];

    // A single hanging request must not stall the whole check, so every call is bounded. Without
    // this, one unresponsive MyMarky endpoint leaves the button spinning with no result at all.
    const PER_REQUEST_MS = 8000;
    const TIMEOUT_ERR = 'Timed out after ' + (PER_REQUEST_MS / 1000) + 's - MyMarky did not respond';

    const results = [];
    for (const attempt of attempts) {
      const url = MYMARKY_API + '/businesses/' + businessId + '/posts' + (attempt.qs ? '?' + attempt.qs : '');
      try {
        const res = await fetch(url, {
          headers: { Authorization: 'Bearer ' + apiKey },
          signal: AbortSignal.timeout(PER_REQUEST_MS),
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

        results.push({
          query: attempt.label,
          httpStatus: res.status,
          topLevelKeys: Array.isArray(body) ? ['(array body)'] : Object.keys(obj),
          returnedCount: items ? items.length : null,
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
        });
      } catch (e) {
        // A timeout is the expected failure here, so name it plainly instead of surfacing the
        // raw "operation was aborted" message, which reads like a crash.
        const aborted = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        results.push({
          query: attempt.label,
          error: aborted ? TIMEOUT_ERR : (e instanceof Error ? e.message : String(e)).slice(0, 200),
          timedOut: aborted || undefined,
        });
      }
    }

    return new Response(JSON.stringify({ brand: slug, businessId, results }, null, 2), {
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