import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';

const STORAGE_KEY = 'lumensocial_auth';

export function AuthGate({ children }: { children?: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === 'true') setAuthenticated(true);
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const response = await fetch('/api/auth-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (response.ok) {
      sessionStorage.setItem(STORAGE_KEY, 'true');
      sessionStorage.setItem('lumensocial_pw', password);
      setAuthenticated(true);
    } else {
      setError('Incorrect password');
    }
  }

  if (authenticated) return children ? <>{children}</> : <Outlet />;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div className="card" style={{ width: '100%', maxWidth: '360px' }}>
        <h2 style={{ marginBottom: '1rem', textAlign: 'center' }}>LumenSocial</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center', marginBottom: '1.5rem' }}>Enter your admin password to continue</p>
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" autoFocus />
          </div>
          {error && <p style={{ color: 'var(--error)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Enter</button>
        </form>
      </div>
    </div>
  );
}