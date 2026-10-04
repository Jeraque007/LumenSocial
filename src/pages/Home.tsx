import { Link } from 'react-router-dom';

export function Home() {
  return (
    <main style={{ maxWidth: '760px', margin: '0 auto', padding: '3rem 1.5rem 5rem', lineHeight: 1.6 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', marginBottom: '3.5rem' }}>
        <img
          src="/images/LumenSociallogo.jpg"
          alt="LumenSocial logo"
          style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '12px' }}
        />
        <p style={{ color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.04em', margin: 0 }}>LUMENSOCIAL</p>
      </header>
      <h1 style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', margin: '0.75rem 0 1rem' }}>
        Social publishing, gathered in one place.
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', maxWidth: '620px' }}>
        LumenSocial helps authorized account owners review, schedule, and publish approved content to Facebook, Instagram, and LinkedIn.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '2rem' }}>
        <Link to="/app" className="btn btn-primary">Open LumenSocial</Link>
        <Link to="/tessera-lumen" className="btn" style={{ background: 'var(--border)', color: 'var(--text)' }}>Tessera Lumen</Link>
        <Link to="/privacy" className="btn" style={{ background: 'var(--border)', color: 'var(--text)' }}>Privacy Policy</Link>
        <Link to="/terms" className="btn" style={{ background: 'var(--border)', color: 'var(--text)' }}>Terms</Link>
      </div>
    </main>
  );
}
