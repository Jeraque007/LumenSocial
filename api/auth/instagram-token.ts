// Instagram token validation / refresh helper
// Validates whether an incoming IGAA token already works against the Instagram Graph API.
// If it already does, the app should use it directly as INSTAGRAM_ACCESS_TOKEN and
// rotate it using the refresh flow when it is close to expiry.
//
// Usage:
//   GET  /api/auth/instagram-token?token=IGAA...
//   POST /api/auth/instagram-token with JSON body { token: "IGAA..." }

export default async function handler(req: Request) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const url = new URL(req.url);
  const tokenFromQuery = url.searchParams.get('token');
  let brandFromBody: string | null = null;

  let shortLivedToken = tokenFromQuery;
  if (!shortLivedToken && req.method === 'POST') {
    try {
      const body = await req.json() as { token?: string; brand?: string };
      shortLivedToken = body?.token ?? null;
      brandFromBody = body?.brand ?? null;
    } catch {
      shortLivedToken = null;
    }
  }

  // Which brand's environment variables these IDs belong to. Defaults to S.A.E Method so the
  // existing single-brand flow is unchanged; pass ?brand=HOAWS (or { brand: 'HOAWS' } on POST)
  // when validating the HOAWS Instagram account.
  const requestedBrand = (url.searchParams.get('brand') || brandFromBody || '').trim();
  const isHoawsBrand = requestedBrand.toLowerCase() === 'hoaws';
  const envPrefix = isHoawsBrand ? 'HOAWS_INSTAGRAM_' : 'INSTAGRAM_';
  const brandName = isHoawsBrand ? 'HOAWS' : 'S.A.E Method';

  // If no token, show the setup page
  if (!shortLivedToken) {
    return new Response(
      `<!DOCTYPE html>
<html>
<head>
  <title>Instagram Token Setup</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #f5f5f5;
      padding: 2rem;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      max-width: 700px;
      width: 100%;
      background: #141414;
      padding: 2rem;
      border-radius: 12px;
      border: 1px solid #2a2a2a;
    }
    h1 { color: #7c3aed; margin-bottom: 1.5rem; font-size: 1.8rem; }
    .env-section {
      background: #1a1a1a;
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      border-left: 3px solid #7c3aed;
    }
    .env-section h3 { color: #7c3aed; margin-bottom: 0.5rem; font-size: 1rem; }
    .env-section p, .env-section li { color: #aaa; font-size: 0.9rem; line-height: 1.6; }
    code {
      background: #0a0a0a;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      color: #f5f5f5;
    }
    .env-box {
      background: #0a0a0a;
      padding: 1rem;
      border-radius: 6px;
      border: 1px solid #2a2a2a;
      margin: 0.5rem 0;
      font-family: monospace;
      font-size: 0.8rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 0.75rem;
      background: #0a0a0a;
      color: #f5f5f5;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      font-size: 1rem;
      margin: 0.5rem 0;
      font-family: monospace;
    }
    input[type="text"]:focus, input[type="password"]:focus {
      outline: none;
      border-color: #7c3aed;
    }
    button {
      background: #7c3aed;
      color: white;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 6px;
      font-size: 1rem;
      cursor: pointer;
      width: 100%;
      transition: background 0.2s;
    }
    button:hover { background: #6d28d9; }
    .token-box {
      background: #0a0a0a;
      padding: 1rem;
      border-radius: 6px;
      border: 1px solid #2a2a2a;
      margin: 1rem 0;
      word-break: break-all;
      font-family: monospace;
      font-size: 0.75rem;
      max-height: 150px;
      overflow-y: auto;
    }
    .success { color: #10b981; }
    .error { color: #ef4444; }
    .warning { color: #f59e0b; }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-green { background: #064e3b; color: #10b981; }
    .badge-yellow { background: #451a03; color: #f59e0b; }
    .badge-red { background: #450a0a; color: #ef4444; }
    .badge-blue { background: #1e3a5f; color: #3b82f6; }
    .mt-2 { margin-top: 1rem; }
    .mb-2 { margin-bottom: 1rem; }
    hr { border: none; border-top: 1px solid #2a2a2a; margin: 1.5rem 0; }
    .flex { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .debug-box {
      background: #0a0a0a;
      padding: 0.75rem;
      border-radius: 6px;
      border: 1px solid #2a2a2a;
      margin-top: 0.5rem;
      font-family: monospace;
      font-size: 0.75rem;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📸 Instagram Token Exchange</h1>
    
    <div class="env-section" style="border-color:#f59e0b;">
      <h3 style="color:#f59e0b;">⚠️ Important</h3>
      <p>Make sure your Facebook App is in <strong>Live Mode</strong> (not Development Mode).</p>
      <p>Your token must start with <code>IGAA...</code></p>
    </div>

    <div class="env-section">
      <h3>Step 1: Enter Your Short-Lived Token</h3>
      <p>Paste your short-lived Instagram token (starts with IGAA...):</p>
      <form id="tokenForm">
        <div class="env-section" style="border-color:#7c3aed;">
          <h3>Brand</h3>
          <select id="brandInput" style="width:100%;padding:0.75rem;background:#0a0a0a;color:#f5f5f5;border:1px solid #2a2a2a;border-radius:6px;font-size:1rem;">
            <option value="S.A.E Method">S.A.E Method</option>
            <option value="HOAWS">HOAWS</option>
          </select>
          <p>The IDs returned below are read from the token itself and use the matching
          INSTAGRAM_* or HOAWS_INSTAGRAM_* variable names.</p>
        </div>
        <input type="password" id="tokenInput" placeholder="IGAA0g@WwtFbZ2AFK3UE35cKdfFa2bLUMdzFaBBeWUJ3IRFcFZAXcTgAXX3jYlnTbR3ME1UVjNhlm8LQvXb1Eybs9YIjZArb2N6lV1oZgAFKTRVZAcW0RmfZMbS0NQ4QxQZAX1ZAYUDF1b1R9ZA2BZAZ0h4aDvctTNsLXpaTpKk1lG4QzD2D" />
        <button type="submit">Exchange for Long-Lived Token</button>
      </form>
    </div>

    <div id="result" style="margin-top:1rem;"></div>
    
    <div id="debug" style="margin-top:1rem;"></div>
  </div>

  <script>
    document.getElementById('tokenForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = document.getElementById('tokenInput').value.trim();
      const brand = document.getElementById('brandInput').value;
      if (!token) {
        alert('Please enter a token');
        return;
      }
      
      if (!token.startsWith('IGAA')) {
        alert('Token must start with IGAA...');
        return;
      }
      
      const resultDiv = document.getElementById('result');
      const debugDiv = document.getElementById('debug');
      resultDiv.innerHTML = '<p style="color:#7c3aed;">⏳ Exchanging token...</p>';
      debugDiv.innerHTML = '';
      
      try {
        const response = await fetch(\`/api/auth/instagram-token?token=\${encodeURIComponent(token)}&brand=\${encodeURIComponent(brand)}\`);
        const contentType = response.headers.get('content-type');
        
        // Check if response is JSON
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          
          if (data.success) {
            resultDiv.innerHTML = \`
              <div style="background:#064e3b;padding:1rem;border-radius:6px;border:1px solid #10b981;">
                <p class="success">✅ Token Exchange Successful!</p>
                <div class="flex" style="margin-top:0.5rem;">
                  <span class="badge badge-green">Stored in Supabase</span>
                  <span class="badge badge-yellow">\${data.expires_in_days} days valid</span>
                </div>
                <div style="margin-top:0.75rem;">
                  <p style="font-size:0.85rem;color:#aaa;margin-bottom:0.25rem;">Your new long-lived token:</p>
                  <div class="token-box">\${data.access_token}</div>
                </div>
                <div style="margin-top:0.75rem;background:#0a0a0a;padding:0.75rem;border-radius:6px;">
                  <p style="font-size:0.85rem;color:#7c3aed;font-weight:600;">Add these to Vercel .env for \${data.brand || 'S.A.E Method'}:</p>
                  <div style="font-family:monospace;font-size:0.8rem;color:#f5f5f5;word-break:break-all;">
                    \${Object.entries(data.env_vars_to_set || {}).map(([key, value]) => key + '=' + value).join('<br>')}
                  </div>
                </div>
                <p style="font-size:0.8rem;color:#f59e0b;margin-top:0.75rem;">
                  ⏰ Refresh this token every 50 days before it expires
                </p>
                <p style="font-size:0.8rem;color:#ef4444;margin-top:0.5rem;">
                  🔒 Never share this token publicly
                </p>
              </div>
            \`;
          } else {
            resultDiv.innerHTML = \`
              <div style="background:#450a0a;padding:1rem;border-radius:6px;border:1px solid #ef4444;">
                <p class="error">❌ Exchange Failed</p>
                <div class="debug-box">\${JSON.stringify(data, null, 2)}</div>
              </div>
            \`;
          }
        } else {
          // Not JSON - show raw response
          const text = await response.text();
          resultDiv.innerHTML = \`
            <div style="background:#450a0a;padding:1rem;border-radius:6px;border:1px solid #ef4444;">
              <p class="error">❌ Server returned non-JSON response</p>
              <p style="color:#aaa;font-size:0.85rem;">Status: \${response.status}</p>
              <div class="debug-box">\${text.substring(0, 500)}</div>
            </div>
          \`;
        }
      } catch (error) {
        resultDiv.innerHTML = \`
          <div style="background:#450a0a;padding:1rem;border-radius:6px;border:1px solid #ef4444;">
            <p class="error">❌ Request Failed</p>
            <p style="font-size:0.9rem;color:#aaa;">\${error.message}</p>
          </div>
        \`;
      }
    });
  </script>
</body>
</html>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  // --- Token Validation / Refresh Logic ---
  console.log('Instagram Token Validation - Starting');

  // Log the token prefix for debugging (never log the full token)
  console.log('Token prefix:', shortLivedToken.substring(0, 10) + '...');

  // Validate token format
  if (!shortLivedToken.startsWith('IGAA')) {
    console.log('Invalid token format - does not start with IGAA');
    return new Response(
      JSON.stringify({ 
        error: 'Invalid token format', 
        message: 'Token must start with IGAA...',
        received: shortLivedToken.substring(0, 10) + '...'
      }),
      { 
        status: 400, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        } 
      }
    );
  }

  try {
    // First verify whether the supplied token already works against the Instagram Graph API.
    // If yes, use it directly. Re-exchanging a token that Meta already accepts is the root cause
    // of the 452 / error_subcode 2207055 rejection observed in production.
    const currentTokenProbe = new URL('https://graph.instagram.com/v25.0/me');
    // user_id = the Instagram professional account ID that MUST be used in POST /<IG_ID>/media
    // (it is also the ID shown in App Dashboard > Instagram > API setup with Instagram login, and
    // the id value delivered in webhooks for that account).
    // id = the APP-SCOPED user ID, which /<IG_ID>/media rejects with error 100 / subcode 33.
    currentTokenProbe.searchParams.append('fields', 'id,user_id,username,account_type');
    currentTokenProbe.searchParams.append('access_token', shortLivedToken);

    const currentTokenRes = await fetch(currentTokenProbe.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });

    if (currentTokenRes.ok) {
      const currentTokenData = await currentTokenRes.json();
      // Publish-capable ID first: "user_id" is the Instagram professional account ID. "id" is only
      // the app-scoped ID, so it is a fallback for display purposes and never the preferred value.
      const currentAccountId = ((currentTokenData.user_id || currentTokenData.id || '') as string).trim() || null;
      const currentAppScopedId = ((currentTokenData.id || '') as string).trim() || null;
      console.log('Token already valid for Instagram Graph API:', currentAccountId || currentTokenData.username || 'unknown user');

      return new Response(
        JSON.stringify({
          success: true,
          already_valid: true,
          token_type: 'instagram_graph_access_token',
          message: 'This token already works with the Instagram Graph API. Use it directly as INSTAGRAM_ACCESS_TOKEN and refresh it with the Instagram refresh token flow when it approaches expiry.',
          brand: brandName,
          graph_user_id: currentAccountId,
          username: currentTokenData.username,
          detected_account_id: currentAccountId,
          app_scoped_user_id: currentAppScopedId,
          // user_id (NOT id) is the Instagram professional account ID accepted by
          // POST /<IG_ID>/media. It is discovered from GET graph.instagram.com/v25.0/me for THIS
          // token and must never be hard-coded: the previously fixed S.A.E Method IDs sent HOAWS
          // posts to the wrong account, and the app-scoped id returned in "id" is rejected with
          // error 100 / subcode 33.
          env_vars_to_set: {
            [`${envPrefix}ACCESS_TOKEN`]: shortLivedToken,
            ...(currentAccountId ? {
              [`${envPrefix}BUSINESS_ACCOUNT_ID`]: currentAccountId,
              [`${envPrefix}GRAPH_USER_ID`]: currentAccountId,
            } : {}),
          },
          known_account_ids: {
            instagram_login_account_id: currentAccountId,
            instagram_graph_user_id: currentAccountId,
            app_scoped_user_id: currentAppScopedId,
            note: 'Use user_id (the Instagram professional account ID, same number as the App Dashboard account list) in /<IG_ID>/media. The app-scoped id cannot publish.',
            source: 'discovered from graph.instagram.com/v25.0/me (user_id field) using the supplied token',
          },
          refresh_flow: {
            endpoint: 'https://graph.instagram.com/refresh_access_token',
            grant_type: 'ig_refresh_token',
            access_token: shortLivedToken,
          },
        }, null, 2),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appSecret) {
      console.error('FACEBOOK_APP_SECRET not set');
      return new Response(
        JSON.stringify({
          error: 'FACEBOOK_APP_SECRET is not set in environment variables',
          hint: 'The token does not appear to be a valid Instagram Graph token yet. If your app uses the Instagram Login flow, re-run the OAuth flow and supply a fresh short-lived token that Meta can exchange.',
          env_vars_available: Object.keys(process.env).filter(k => k.includes('FACEBOOK') || k.includes('INSTAGRAM'))
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        }
      );
    }

    // Build the exchange URL only when the token is not already valid.
    const exchangeUrl = new URL('https://graph.instagram.com/access_token');
    exchangeUrl.searchParams.append('grant_type', 'ig_exchange_token');
    exchangeUrl.searchParams.append('client_secret', appSecret);
    exchangeUrl.searchParams.append('access_token', shortLivedToken);

    console.log('Exchange URL:', exchangeUrl.toString().replace(/access_token=[^&]*/, 'access_token=REDACTED'));

    // Make the request to Meta
    const exchangeRes = await fetch(exchangeUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });

    console.log('Meta response status:', exchangeRes.status);
    console.log('Meta response headers:', Object.fromEntries(exchangeRes.headers.entries()));

    const responseText = await exchangeRes.text();
    console.log('Meta response length:', responseText.length);
    console.log('Meta response preview:', responseText.substring(0, 200));

    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse Meta response as JSON:', parseError);
      
      // Check if it's HTML (likely an error page)
      const isHTML = responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html');
      
      return new Response(
        JSON.stringify({ 
          error: isHTML ? 'Meta API returned HTML error page' : 'Meta API returned non-JSON response',
          status: exchangeRes.status,
          statusText: exchangeRes.statusText,
          response_preview: responseText.substring(0, 500),
          meta_url: exchangeUrl.toString().replace(/access_token=[^&]*/, 'access_token=REDACTED'),
          tip: isHTML ? 'Your Facebook App might be in Development Mode. Set it to Live Mode in Meta Developer Dashboard.' : undefined
        }),
        { 
          status: exchangeRes.status || 500, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }

    if (data.error || !data.access_token) {
      console.error('Meta API returned error:', data.error || data);
      return new Response(
        JSON.stringify({ 
          error: 'Token exchange failed',
          meta_error: data.error || data,
          meta_error_message: data.error?.message || 'Unknown error',
          meta_error_type: data.error?.type || 'Unknown',
          status: exchangeRes.status || 400
        }),
        { 
          status: exchangeRes.status || 400, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          } 
        }
      );
    }

    const longLivedToken = data.access_token;
    const expiresIn = data.expires_in || 5184000;
    const expiresInDays = Math.floor(expiresIn / 86400);

    console.log('Token exchange successful! Expires in:', expiresInDays, 'days');

    // Discover which Instagram account this long-lived token belongs to, so the IDs we hand
    // back are never another brand's account.
    let resolvedAccountId: string | null = null;
    let resolvedUsername: string | null = null;
    try {
      const meUrl = new URL('https://graph.instagram.com/v25.0/me');
      meUrl.searchParams.append('fields', 'id,user_id,username,account_type');
      meUrl.searchParams.append('access_token', longLivedToken);
      const meRes = await fetch(meUrl.toString(), { headers: { Accept: 'application/json' } });
      if (meRes.ok) {
        const meData = await meRes.json();
        // user_id is the Instagram professional account ID used for publishing. The "id" field is the
        // app-scoped ID and POST /<IG_ID>/media rejects it with error 100 / subcode 33.
        resolvedAccountId = meData?.user_id ?? meData?.id ?? null;
        resolvedUsername = meData?.username ?? null;
        console.log('Resolved Instagram account from /me:', resolvedAccountId, resolvedUsername);
      } else {
        console.log('Could not resolve account id from /me:', meRes.status);
      }
    } catch (resolveError) {
      console.log('Could not resolve account id from /me:', resolveError);
    }

    // No hard-coded fallback: an incorrect account ID silently targets another brand's account
    // (the original HOAWS failure mode). The variables below are only emitted when /me gave us the
    // real Instagram professional account ID of THIS token.
    const accountIdForEnv = resolvedAccountId;

    // Store in Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    let stored = false;
    let storageError = null;

    if (supabaseUrl && supabaseKey) {
      try {
        // Check if table exists by trying to get a record
        const tableCheck = await fetch(`${supabaseUrl}/rest/v1/instagram_settings?select=id&limit=1`, {
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
          }
        });

        if (tableCheck.status === 404) {
          // Table doesn't exist - create it
          console.log('Table instagram_settings doesn\'t exist, skipping storage');
          storageError = 'Table instagram_settings not found in Supabase';
        } else {
          const existing = await tableCheck.json();
          const hasExisting = existing && existing.length > 0;

          const storeResponse = await fetch(`${supabaseUrl}/rest/v1/instagram_settings`, {
            method: hasExisting ? 'PATCH' : 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
              'apikey': supabaseKey,
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              ...(hasExisting ? {} : {
                account_id: accountIdForEnv,
                created_at: new Date().toISOString()
              }),
              access_token: longLivedToken,
              expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
          });

          if (storeResponse.ok) {
            stored = true;
            console.log('Token stored in Supabase successfully');
          } else {
            const errorText = await storeResponse.text();
            storageError = `Supabase error: ${storeResponse.status} - ${errorText}`;
            console.error('Failed to store token:', storageError);
          }
        }
      } catch (error) {
        storageError = error instanceof Error ? error.message : 'Unknown storage error';
        console.error('Failed to store token in Supabase:', storageError);
      }
    } else {
      storageError = 'Supabase credentials not configured';
      console.log('Supabase not configured, skipping storage');
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        stored_in_supabase: stored,
        storage_error: storageError,
        access_token: longLivedToken,
        expires_in: expiresIn,
        expires_in_days: expiresInDays,
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        brand: brandName,
        detected_account_id: resolvedAccountId,
        detected_username: resolvedUsername,
        env_vars_to_set: {
          [`${envPrefix}ACCESS_TOKEN`]: longLivedToken,
          ...(accountIdForEnv ? { [`${envPrefix}BUSINESS_ACCOUNT_ID`]: accountIdForEnv } : {}),
          ...(accountIdForEnv ? { [`${envPrefix}GRAPH_USER_ID`]: accountIdForEnv } : {}),
        },
        known_account_ids: {
          instagram_login_account_id: accountIdForEnv || null,
          instagram_graph_user_id: accountIdForEnv || null,
          note: 'Both variables take the same value: the Instagram professional account ID (the user_id field of /me), i.e. the 17-digit number listed next to the account in App Dashboard > Instagram > API setup with Instagram login. The app-scoped id (the id field of /me) is NOT publishable.',
          source: resolvedAccountId
            ? 'discovered from graph.instagram.com/v25.0/me (user_id field) using the newly issued long-lived token'
            : 'not discovered - run GET https://graph.instagram.com/v25.0/me?fields=id,user_id,username&access_token=<token> and copy user_id (NOT id)',
        }
      }, null, 2),
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        } 
      }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Request failed', 
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        } 
      }
    );
  }
}

export const config = { 
  runtime: 'edge',
  regions: ['iad1'], // US East (N. Virginia) - closer to Meta's APIs
};