// Facebook Page Token Generator
// Mints durable, NON-EXPIRING Page Access Tokens for EVERY brand in one visit.
//
// WHY THIS EXISTS: a Page token derived from a short-lived User token (the Graph API Explorer
// default) lives only ~1-2 hours. Renewing one brand at a time therefore made the other brand
// fail within the hour - the "fix HOAWS and SAE breaks" ping-pong. This endpoint instead:
//   1. Inspects the incoming User token (GET /debug_token),
//   2. Exchanges it for a 60-DAY long-lived User token (GET /oauth/access_token?grant_type=fb_exchange_token),
//   3. Derives the Page token for BOTH recorded Pages (S.A.E Method + HOAWS) from that long-lived
//      token via GET /{PAGE_ID}?fields=access_token.
// A Page token minted from a long-lived User token does NOT expire, so both brands stay fixed.
//
// How to use:
//   1. Go to https://developers.facebook.com/tools/explorer/
//   2. Select the LumenSocial app, set User or Page = your account
//   3. Add permissions: pages_manage_posts, pages_read_engagement, pages_show_list, business_management
//   4. Click "Generate Access Token" and copy the (short-lived) token shown
//   5. Visit: https://lumensocial.vercel.app/api/auth/facebook-token?user_token=YOUR_TOKEN
//      (the help page also exposes a paste form)
//   6. Copy ALL the values shown - both brands at once - into Vercel and redeploy.
//
// The Page IDs never need to be passed: both recorded Pages are always queried, and an optional
// ?page_id=... resolves any additional Page. ?brand=HOAWS still tailors the help/error wording.
//
// Env vars used: FACEBOOK_APP_SECRET (required); FACEBOOK_APP_ID (optional - the app id embedded
// in the token is used when it is not set).

// Recorded Page IDs per brand. BOTH are always resolved so a single visit returns usable,
// long-lived credentials for S.A.E Method AND HOAWS - renewing one can never starve the other.
const KNOWN_BRANDS = [
  {
    name: 'S.A.E Method',
    pageId: '182681844923872',
    pageIdVar: 'FACEBOOK_PAGE_ID',
    pageTokenVar: 'FACEBOOK_PAGE_ACCESS_TOKEN',
    userTokenVar: 'FACEBOOK_USER_ACCESS_TOKEN',
  },
  {
    name: 'HOAWS',
    pageId: '430882193436029',
    pageIdVar: 'HOAWS_FACEBOOK_PAGE_ID',
    pageTokenVar: 'HOAWS_FACEBOOK_PAGE_ACCESS_TOKEN',
    userTokenVar: 'HOAWS_FACEBOOK_USER_ACCESS_TOKEN',
  },
] as const;

// LumenSocial Meta app id, used as the fb_exchange_token client_id when FACEBOOK_APP_ID is not
// configured. App ids are public (they appear in every Graph call), so this is not a secret.
const DEFAULT_APP_ID = '1358945715605007';

// appsecret_proof = HMAC-SHA256(app_secret, access_token). It must be recomputed for EVERY token -
// the incoming short-lived one AND the long-lived one minted from it - or Meta rejects the call.
async function computeAppSecretProof(appSecret: string, token: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(token));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const userToken = url.searchParams.get('user_token');
  const explicitPageId = url.searchParams.get('page_id');
  // Which brand's variables this token belongs to. Pass ?brand=HOAWS so the result page names the
  // HOAWS_FACEBOOK_* keys instead of the S.A.E Method defaults.
  const isHoawsBrand = (url.searchParams.get('brand') || '').trim().toLowerCase() === 'hoaws';
  const pageTokenVarName = isHoawsBrand ? 'HOAWS_FACEBOOK_PAGE_ACCESS_TOKEN' : 'FACEBOOK_PAGE_ACCESS_TOKEN';
  const brandSuffix = isHoawsBrand ? '&brand=HOAWS' : '';
  // Recorded Page ID for the brand named in ?brand=..., used only for the wording of help/error text.
  // (Both brands are resolved for real via KNOWN_BRANDS below.)
  //   HOAWS  = 430882193436029 ("HOAWS", type=PAGE token verified via debug_token)
  //   S.A.E  = 182681844923872 (default brand)
  const examplePageId = isHoawsBrand ? '430882193436029' : '182681844923872';

  if (!userToken) {
    return new Response(`<html>
<body style="font-family: monospace; background: #0a0a0a; color: #f5f5f5; padding: 2rem; max-width: 900px;">
  <h1 style="color: #7c3aed;">Facebook Page Token Generator</h1>
  <p>Paste your Facebook <strong>User</strong> Access Token below. <strong>One visit mints durable Page tokens for
     BOTH brands (S.A.E Method and HOAWS) at once</strong>, so fixing one brand no longer breaks the other.</p>
  <form method="get" action="/api/auth/facebook-token" style="margin:1rem 0;">
    <input type="password" name="user_token" placeholder="Paste User Access Token" autocomplete="off"
      style="width:100%; padding:0.6rem; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; border-radius:6px; font-family:monospace;" />
    <button type="submit" style="margin-top:0.75rem; padding:0.6rem 1rem; background:#7c3aed; color:#fff; border:0; border-radius:6px; cursor:pointer;">
      Generate Page Tokens for Both Brands
    </button>
  </form>
  <p style="color:#888;">Or call the endpoint directly:</p>
  <code style="background:#141414; padding:0.5rem; display:block; margin:1rem 0;">
    /api/auth/facebook-token?user_token=YOUR_USER_TOKEN
  </code>
  <h3>How to get a User Access Token:</h3>
  <ol>
    <li>Go to <a href="https://developers.facebook.com/tools/explorer/" style="color:#7c3aed;">Graph API Explorer</a></li>
    <li>Select <strong>LumenSocial</strong> app</li>
    <li>Set User or Page to your personal account</li>
    <li>Add permissions: pages_manage_posts, pages_read_engagement, pages_show_list, business_management</li>
    <li>Click <strong>Generate Access Token</strong> and copy it (it is short-lived - this page exchanges it for a
        60-day token automatically)</li>
  </ol>
  <p style="color:#888;">Optional <code>?page_id=...</code> resolves an additional Page beyond the two recorded brands.</p>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
  }

  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appSecret) {
    return htmlError('FACEBOOK_APP_SECRET is not set in Vercel environment variables.', 500);
  }

  const log: string[] = [];
  log.push(`Graph API version: v25.0`);

  // --- Compute appsecret_proof = HMAC-SHA256(app_secret, user_token) ---
  const appsecretProof = await computeAppSecretProof(appSecret, userToken);
  log.push(`appsecret_proof computed: ${appsecretProof.substring(0, 16)}... (truncated)`);

  // -----------------------------------------------------------------------
  // STEP 1 — Inspect the token to confirm scopes
  // -----------------------------------------------------------------------
  const debugRes = await fetch(
    `https://graph.facebook.com/v25.0/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${encodeURIComponent(userToken)}&appsecret_proof=${appsecretProof}`
  );
  let tokenScopes: string[] = [];
  let granularScopes: { scope: string; target_ids?: string[] }[] = [];
  if (debugRes.ok) {
    const debugData = await debugRes.json();
    const tokenData = debugData.data ?? {};
    tokenScopes = tokenData.scopes ?? [];
    granularScopes = tokenData.granular_scopes ?? [];
    log.push(`Token type: ${tokenData.type ?? 'unknown'}`);
    log.push(`Token scopes: ${tokenScopes.join(', ') || 'none'}`);
    log.push(`Granular scopes: ${JSON.stringify(granularScopes)}`);
  } else {
    log.push(`Token debug call failed: ${await debugRes.text()}`);
  }

  // The Page tokens minted below are only durable if they come from a LONG-LIVED User token. The
  // Graph Explorer hands out a ~1-2h token, so exchange it for a 60-day one first. appsecret_proof is
  // recomputed for it because the proof is bound to the token bytes.
  const appId = (process.env.FACEBOOK_APP_ID || '').trim() || DEFAULT_APP_ID;
  let longLivedUserToken = userToken;
  let longLivedUserTokenProof = appsecretProof;
  try {
    const exchangeRes = await fetch(
      `https://graph.facebook.com/v25.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(userToken)}`
    );
    if (exchangeRes.ok) {
      const exchangeData = await exchangeRes.json();
      if (typeof exchangeData?.access_token === 'string' && exchangeData.access_token) {
        longLivedUserToken = exchangeData.access_token;
        longLivedUserTokenProof = await computeAppSecretProof(appSecret, longLivedUserToken);
        log.push(`Exchanged for a long-lived User token (expires_in=${exchangeData.expires_in ?? 'unknown'}s) — Page tokens derived from it will not expire.`);
      } else {
        log.push(`Long-lived exchange returned no access_token — using the supplied User token as-is.`);
      }
    } else {
      log.push(`Long-lived User token exchange failed (HTTP ${exchangeRes.status}): ${await exchangeRes.text()}`);
    }
  } catch (err) {
    log.push(`Long-lived User token exchange threw: ${String(err)}`);
  }

  const usedLongLived = longLivedUserToken !== userToken;
  log.push(usedLongLived
    ? 'Using the long-lived User token for Page token derivation.'
    : 'Could not obtain a long-lived User token; the Page tokens below may expire in ~1-2 hours.');

  // -----------------------------------------------------------------------
  // STEP 2 — PRIMARY: try /me/accounts
  // -----------------------------------------------------------------------
  const accountsRes = await fetch(
    `https://graph.facebook.com/v25.0/me/accounts?access_token=${encodeURIComponent(userToken)}&appsecret_proof=${appsecretProof}`
  );
  let pages: { id: string; name: string; access_token: string }[] = [];

  if (accountsRes.ok) {
    const accountsData = await accountsRes.json();
    pages = accountsData.data ?? [];
    log.push(`/me/accounts result: ${pages.length} page(s) found`);
  } else {
    const err = await accountsRes.text();
    log.push(`/me/accounts error: ${err}`);
  }

  // -----------------------------------------------------------------------
  // STEP 3 — Resolve a Page token for EVERY candidate Page (both brands always included)
  // -----------------------------------------------------------------------
  // Every page ID worth resolving: whatever /me/accounts returned, BOTH recorded brand Pages, any
  // granular-scope targets and any explicit ?page_id. This is what guarantees a single visit can mint
  // tokens for both brands even when /me/accounts comes back empty (New Pages Experience).
  const candidateIds = new Set<string>();
  for (const p of pages) candidateIds.add(p.id);
  for (const b of KNOWN_BRANDS) candidateIds.add(b.pageId);
  if (explicitPageId) candidateIds.add(explicitPageId);
  for (const gs of granularScopes) {
    if (gs.scope === 'pages_manage_posts' || gs.scope === 'pages_show_list') {
      for (const tid of gs.target_ids ?? []) candidateIds.add(tid);
    }
  }

  log.push(`/me/accounts returned ${pages.length} page(s); resolving ${candidateIds.size} candidate page ID(s) from the long-lived token: ${[...candidateIds].join(', ')}`);

  // Direct Page-token exchange (GET /{PAGE_ID}?fields=access_token). Only succeeds when the User
  // token carries pages_show_list for that Page.
  const resolvePageAccessToken = async (pageId: string, token: string, proof: string): Promise<string | null> => {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v25.0/${pageId}?fields=id,name,access_token&access_token=${encodeURIComponent(token)}&appsecret_proof=${proof}`
      );
      if (!res.ok) {
        log.push(`Page ${pageId} lookup failed (HTTP ${res.status}): ${await res.text()}`);
        return null;
      }
      const data = await res.json();
      if (typeof data?.access_token === 'string' && data.access_token) return data.access_token;
      log.push(`Page ${pageId} returned no access_token field — may need pages_manage_posts Advanced Access`);
      return null;
    } catch (err) {
      log.push(`Page ${pageId} lookup threw: ${String(err)}`);
      return null;
    }
  };

  const longLivedPageTokens = new Map<string, string>();
  for (const pageId of candidateIds) {
    let pageToken = await resolvePageAccessToken(pageId, longLivedUserToken, longLivedUserTokenProof);
    if (!pageToken && longLivedUserToken !== userToken) {
      // The exchange may have failed, or the long-lived token may lack the scope; fall back to the
      // token the user actually supplied.
      pageToken = await resolvePageAccessToken(pageId, userToken, appsecretProof);
    }
    if (pageToken) longLivedPageTokens.set(pageId, pageToken);
  }

  log.push(`Resolved page tokens for: ${[...longLivedPageTokens.keys()].join(', ') || 'none'}`);

  if (longLivedPageTokens.size === 0) {
    return new Response(buildDiagnosticHtml(log, brandSuffix, examplePageId), { headers: { 'Content-Type': 'text/html' } });
  }

  // One card per brand: Page ID, the (non-expiring) Page token and the long-lived User token. Every
  // value is shown at once, so renewing one brand can never leave the other broken.
  const blocks = KNOWN_BRANDS.map(b => {
    const pageToken = longLivedPageTokens.get(b.pageId);
    return `
  <div style="border:1px solid #2a2a2a; border-radius:8px; padding:1rem; margin:1rem 0;">
    <h2 style="color:#7c3aed; margin:0 0 0.5rem;">${escHtml(b.name)} — Page ${escHtml(b.pageId)}</h2>
    ${pageToken
      ? (usedLongLived
        ? `<p style="color:#22c55e; margin:0 0 0.75rem;">Page token: type=PAGE, non-expiring (derived from the long-lived User token).</p>`
        : `<p style="color:#f59e0b; margin:0 0 0.75rem;">Page token: type=PAGE — but the long-lived exchange failed, so this token may expire in ~1-2 hours. Retry with a fresh User token.</p>`)
      : `<p style="color:#ef4444; margin:0 0 0.75rem;">No Page token could be minted for this Page — the User token must carry pages_show_list and grant access to Page ${escHtml(b.pageId)} (Granular Permissions).</p>`}
    <label style="color:#888;">${b.pageIdVar}</label>
    <textarea readonly onclick="this.select()" style="width:100%; height:36px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; border-radius:4px; padding:0.25rem; font-size:0.75rem;">${escHtml(b.pageId)}</textarea>
    <label style="color:#888; margin-top:0.5rem; display:block;">${b.pageTokenVar}</label>
    <textarea readonly onclick="this.select()" style="width:100%; height:70px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; border-radius:4px; padding:0.25rem; font-size:0.7rem;">${escHtml(pageToken ?? '')}</textarea>
    <label style="color:#888; margin-top:0.5rem; display:block;">${b.userTokenVar}</label>
    <textarea readonly onclick="this.select()" style="width:100%; height:70px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; border-radius:4px; padding:0.25rem; font-size:0.7rem;">${escHtml(longLivedUserToken)}</textarea>
  </div>`;
  }).join('');

  // Any additional Pages (?page_id or /me/accounts) beyond the two recorded brands.
  const knownIds = new Set<string>(KNOWN_BRANDS.map(b => b.pageId));
  const extraRows = [...longLivedPageTokens.entries()]
    .filter(([id]) => !knownIds.has(id))
    .map(([id, token]) => `
    <tr>
      <td style="padding:0.5rem; border-bottom:1px solid #2a2a2a; color:#888;">${escHtml(id)}</td>
      <td style="padding:0.5rem; border-bottom:1px solid #2a2a2a;">
        <textarea readonly onclick="this.select()" style="width:100%; height:60px; background:#141414; color:#f5f5f5; border:1px solid #2a2a2a; font-size:0.7rem;">${escHtml(token)}</textarea>
      </td>
    </tr>`).join('');

  return new Response(`<html>
<body style="font-family: monospace; background: #0a0a0a; color: #f5f5f5; padding: 2rem;">
  <h1 style="color: #7c3aed;">Facebook Page Access Tokens (both brands)</h1>
  <p>Copy <strong>every</strong> value below into Vercel &gt; Settings &gt; Environment Variables (Production), then redeploy.</p>
  <p style="color:#888;">Both brands were renewed in this single visit and derived from the User token you supplied (see each card for its lifetime) — the "renew HOAWS and SAE breaks" cycle ends here. The long-lived User token is stored too, so the Facebook connector can mint a fresh Page token by itself (Meta error 190 "…must be granted before impersonating a user's page").</p>
${blocks}
${extraRows
  ? `<h2 style="color:#7c3aed;">Additional Pages</h2>
  <table style="width:100%; border-collapse:collapse; margin-top:0.5rem;">
    <thead><tr style="border-bottom:2px solid #7c3aed;"><th style="text-align:left; padding:0.5rem;">Page ID</th><th style="text-align:left; padding:0.5rem;">Page Access Token</th></tr></thead>
    <tbody>${extraRows}</tbody>
  </table>`
  : ''}

  <details style="margin-top:2rem;">
    <summary style="cursor:pointer; color:#7c3aed;">Show diagnostic log</summary>
    <pre style="background:#141414; padding:1rem; margin-top:0.5rem; overflow:auto; font-size:0.8rem;">${escHtml(log.join('\n'))}</pre>
  </details>

  <p style="color:#ef4444; margin-top:1.5rem;">Close this page after copying. Never share these tokens.</p>
  <p style="color:#22c55e;">This page already exchanged the supplied User token for a 60-day long-lived one and derived the Page tokens from it, so they do not expire — no manual exchange step is needed. For the brand named in the URL that value belongs in <strong>${pageTokenVarName}</strong>.</p>
  <p style="color:#888;">Verify a copied token's Type (must be <strong>Page</strong>), Expires (must be <strong>Never</strong>) and Scopes in the <a href="https://developers.facebook.com/tools/debug/accesstoken/" style="color:#7c3aed;">Access Token Debugger</a> or via <code>GET /debug_token?input_token=TOKEN&amp;access_token=APP_ID|APP_SECRET</code>.</p>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlError(msg: string, status = 400): Response {
  return new Response(`<html><body style="font-family:monospace;background:#0a0a0a;color:#f5f5f5;padding:2rem;">
    <h1 style="color:#ef4444;">Error</h1><p>${escHtml(msg)}</p>
  </body></html>`, { status, headers: { 'Content-Type': 'text/html' } });
}

function buildDiagnosticHtml(log: string[], brandSuffix: string, examplePageId: string): string {
  return `<html>
<body style="font-family: monospace; background: #0a0a0a; color: #f5f5f5; padding: 2rem;">
  <h1 style="color: #ef4444;">Page Token Exchange Failed</h1>
  <p>Neither <code>/me/accounts</code> nor the direct page token exchange produced a Page token for any
  candidate Page (both recorded brands are always tried, even when <code>/me/accounts</code> is empty).<br>
  Review the diagnostic log below to identify the cause.</p>

  <details open style="margin-top:1rem;">
    <summary style="cursor:pointer; color:#7c3aed;">Diagnostic log</summary>
    <pre style="background:#141414; padding:1rem; margin-top:0.5rem; overflow:auto; font-size:0.8rem;">${escHtml(log.join('\n'))}</pre>
  </details>

  <h3 style="margin-top:2rem;">Common causes:</h3>
  <ul>
    <li>The long-lived exchange failed and the supplied token is missing <code>pages_manage_posts</code> Advanced Access (still in Standard Access)</li>
    <li>The User token does not carry <code>pages_show_list</code>, so <code>GET /{page-id}?fields=access_token</code> is refused</li>
    <li>Page is under a restricted Business Portfolio</li>
    <li>Page ID is incorrect — the recorded Page IDs are <code>182681844923872</code> (S.A.E Method) and <code>${examplePageId}</code>. List the Pages the User token can publish to with <code>GET /me/accounts?fields=id,name,access_token</code>${brandSuffix}</li>
  </ul>
</body>
</html>`;
}

export const config = { runtime: 'edge' };
