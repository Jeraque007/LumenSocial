import { useState } from 'react';

export function InstagramToken() {
  const [shortToken, setShortToken] = useState('');
  const [brand, setBrand] = useState('S.A.E Method');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExchange(e: React.FormEvent) {
    e.preventDefault();
    if (!shortToken) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/auth/instagram-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: shortToken, brand }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(JSON.stringify(data, null, 2));
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(`Request failed: ${err}`);
    }
    setLoading(false);
  }

  const daysValid = result?.expires_in ? Math.floor(result.expires_in / 86400) : null;

  return (
    <div>
      <h1 style={{ marginBottom: '0.5rem' }}>Instagram Token Validation</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
        Validate an Instagram token (IGAA...) for the selected brand and confirm whether it can be used
        directly with the Instagram Graph API. The account ID is read from the token, so the S.A.E Method and
        HOAWS credentials can never be mixed up.
      </p>

      <div className="card" style={{ maxWidth: '700px' }}>
        <form onSubmit={handleExchange}>
          <div className="form-group">
            <label>Brand these credentials belong to</label>
            <select className="select" value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="S.A.E Method">S.A.E Method (INSTAGRAM_*)</option>
              <option value="HOAWS">HOAWS (HOAWS_INSTAGRAM_*)</option>
            </select>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
              The account ID is read from the token itself, so the HOAWS variables always target the
              HOAWS Instagram account.
            </p>
          </div>
          <div className="form-group">
            <label>Short-lived Instagram Token (starts with IGAA...)</label>
            <textarea
              className="textarea"
              value={shortToken}
              onChange={(e) => setShortToken(e.target.value)}
              placeholder="IGAA..."
              style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading || !shortToken}>
            {loading ? <span className="spinner" /> : null}
            {loading ? 'Validating...' : 'Validate Token'}
          </button>
        </form>

        {error && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#2d0606', borderRadius: '8px', border: '1px solid var(--error)' }}>
            <p style={{ color: 'var(--error)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Validation failed:</p>
            <pre style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>{error}</pre>
          </div>
        )}

        {result && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#062d1b', borderRadius: '8px', border: '1px solid var(--success)' }}>
            <p style={{ color: 'var(--success)', marginBottom: '1rem', fontWeight: 600 }}>
              Success! This token is already usable by the Instagram Graph API.
            </p>
            {daysValid ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                Valid for approximately {daysValid} day{daysValid === 1 ? '' : 's'} — rotate it with the refresh
                flow before it expires.
              </p>
            ) : null}
            <div className="form-group">
              <label>Token to paste into Vercel</label>
              <textarea
                className="textarea"
                value={result.access_token}
                readOnly
                style={{ fontFamily: 'monospace', fontSize: '0.75rem', height: '100px' }}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>
            <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--surface)', borderRadius: '6px' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Add these to Vercel for <strong style={{ color: 'var(--text)' }}>{result.brand || brand}</strong>
                {result.username ? ` (@${result.username})` : ''}:
              </p>
              {Object.entries(result.env_vars_to_set || {}).map(([key, value]) => (
                <p key={key} style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text)', wordBreak: 'break-all', margin: '0.25rem 0' }}>
                  <strong style={{ color: 'var(--accent)' }}>{key}</strong> = {String(value)}
                </p>
              ))}
            </div>
            <p style={{ color: 'var(--warning)', fontSize: '0.75rem', marginTop: '0.75rem' }}>
              Copy the token now and add to Vercel. Do not share it in chat.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
