import { Link } from 'react-router-dom';

const appUrl = 'https://app.963.co.za/';
const downloadUrl = 'https://apkpure.com/p/com.godcode963.app';

export function TesseraLumen() {
  return (
    <main className="tessera-page">
      <nav className="tessera-nav" aria-label="Tessera Lumen navigation">
        <Link to="/" className="tessera-mark">
          <img src="/images/tesseralumentransparentlogo.png" alt="Tessera Lumen" />
        </Link>
        <div className="tessera-nav-links">
          <a href="#readings">Readings</a>
          <a href="#guidance">Guidance</a>
          <a href="#download">App</a>
          <a href="#contact">Contact</a>
        </div>
      </nav>

      <section className="tessera-hero">
        <div className="tessera-hero-copy">
          <p className="tessera-eyebrow">Oracle of Sophia</p>
          <h1>Tessera Lumen</h1>
          <p className="tessera-lede">
            A digital portal for intuitive tarot readings and channelled guidance, created to help you meet your next step with clarity.
          </p>
          <div className="tessera-actions">
            <a className="tessera-button tessera-button-primary" href={appUrl} target="_blank" rel="noreferrer">
              Open Tessera Lumen
            </a>
            <a className="tessera-button tessera-button-secondary" href={downloadUrl} target="_blank" rel="noreferrer">
              Download the app
            </a>
          </div>
        </div>
        <div className="tessera-hero-art" aria-label="Tessera Lumen Oracle of Sophia logo">
          <img src="/images/tesseralumenlogo.jpg" alt="Tessera Lumen Oracle of Sophia" />
        </div>
      </section>

      <section className="tessera-section" id="readings">
        <div className="tessera-section-heading">
          <p className="tessera-eyebrow">A quiet space for insight</p>
          <h2>Guidance that meets you where you are.</h2>
        </div>
        <div className="tessera-feature-grid">
          <article className="tessera-feature" id="guidance">
            <span className="tessera-feature-number">01</span>
            <h3>Tarot readings</h3>
            <p>Purchase and receive intuitive tarot card readings online, shaped around the question you are carrying.</p>
          </article>
          <article className="tessera-feature">
            <span className="tessera-feature-number">02</span>
            <h3>Channelled guidance</h3>
            <p>Explore personalised messages intuitively channelled for your energy, season, and unfolding path.</p>
          </article>
          <article className="tessera-feature">
            <span className="tessera-feature-number">03</span>
            <h3>Accessible anywhere</h3>
            <p>Return to your readings from any device, whenever you need a little more perspective.</p>
          </article>
        </div>
      </section>

      <section className="tessera-download" id="download">
        <div>
          <p className="tessera-eyebrow">Carry the oracle with you</p>
          <h2>Begin your reading in the app.</h2>
          <p>Access Tessera Lumen on Android and keep your guidance close wherever the day takes you.</p>
          <a className="tessera-text-link" href={downloadUrl} target="_blank" rel="noreferrer">Get Tessera Lumen on Android <span aria-hidden="true">-&gt;</span></a>
        </div>
        <img className="tessera-app-icon" src="/images/tesseralumenlogo.jpg" alt="Tessera Lumen app icon" />
      </section>

      <section className="tessera-contact" id="contact">
        <p className="tessera-eyebrow">Want a personal session instead?</p>
        <h2>For one-on-one healing, coaching, or integration work.</h2>
        <a className="tessera-button tessera-button-primary" href="https://wa.me/+27848331128" target="_blank" rel="noreferrer">Book via WhatsApp</a>
      </section>

      <footer className="tessera-footer">
        <span>Tessera Lumen</span>
        <div>
          <a href="https://www.sae963.com/" target="_blank" rel="noreferrer">S.A.E</a>
          <a href="https://www.instagram.com/sylvana_sae/" target="_blank" rel="noreferrer">Instagram</a>
          <a href="https://www.linkedin.com/in/sylvana-ellis-8815394b" target="_blank" rel="noreferrer">LinkedIn</a>
          <a href="https://www.sae963.com/interstellar-terms" target="_blank" rel="noreferrer">Privacy</a>
        </div>
      </footer>
    </main>
  );
}
