export function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem', color: 'var(--text)', lineHeight: '1.8' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Privacy Policy</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Last updated: 2 August 2026</p>

      <p>This Privacy Policy applies to LumenSocial, Tessera Lumen, and all services operated under sae963.com (collectively, "the Services"), owned and operated by S.A.E&trade; / Sylvana Ellis.</p>

      {/* Supported Platforms */}
      <div style={{ margin: '2rem 0', padding: '1.5rem', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)' }}>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Supported Platforms</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
          {[
            { name: 'Facebook', color: '#1877F2', letter: 'f' },
            { name: 'Instagram', color: '#E1306C', letter: 'in' },
            { name: 'LinkedIn', color: '#0A66C2', letter: 'li' },
            { name: 'TikTok', color: '#010101', letter: 'tt' },
            { name: 'YouTube', color: '#FF0000', letter: 'yt' },
            { name: 'Google Business', color: '#4285F4', letter: 'gb' },
          ].map(p => (
            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>
                {p.letter.toUpperCase()}
              </div>
              <span style={{ fontSize: '0.9rem' }}>{p.name}</span>
            </div>
          ))}
        </div>
      </div>

      <p style={{ marginBottom: '2rem' }}>
        By using LumenSocial you also agree to our{' '}
        <a href="/terms" style={{ color: 'var(--accent)' }}>Terms of Service</a>.
      </p>


      <h2 style={{ marginTop: '2rem' }}>1. Information We Collect</h2>
      <p><strong>Account Information:</strong> When you connect social media accounts, we store OAuth access tokens required to post on your behalf. We do not store your social media passwords.</p>
      <p><strong>Content Data:</strong> Posts you create, schedule, or approve through the platform are stored in our database until published or deleted.</p>
      <p><strong>Generated Media:</strong> AI-generated images and videos created through the platform are stored temporarily for scheduling purposes.</p>
      <p><strong>Usage Data:</strong> We collect basic usage analytics (page views, feature usage) to improve the service. No personally identifiable information is shared with third parties.</p>

      <h2 style={{ marginTop: '2rem' }}>2. How We Use Your Information</h2>
      <ul>
        <li>To publish scheduled content to your connected social media accounts</li>
        <li>To generate AI content (text, images, videos) based on your configured brand strategy</li>
        <li>To operate, maintain, and improve the Services</li>
        <li>To communicate with you about your account or the Services</li>
      </ul>

      <h2 style={{ marginTop: '2rem' }}>3. Third-Party Services</h2>
      <p>The Services integrate with the following third-party platforms. Each integration is governed by its own privacy policy. We only share the minimum data required for each integration to function.</p>
      <ul>
        <li><strong>Supabase:</strong> Database and authentication (data stored in EU-West region)</li>
        <li><strong>Vercel:</strong> Application hosting and serverless functions</li>
        <li><strong>Pollinations.ai:</strong> AI image and video generation</li>
        <li><strong>Meta (Facebook / Instagram):</strong> Social media posting via Graph API</li>
        <li><strong>LinkedIn:</strong> Social media posting via Community Management API</li>
        <li><strong>TikTok:</strong> Video posting via Content Posting API</li>
        <li><strong>YouTube (Google):</strong> Video uploading via YouTube Data API v3</li>
        <li><strong>Google Business Profile:</strong> Local post creation via Business Profile API</li>
      </ul>

      <h2 style={{ marginTop: '2rem' }}>3A. YouTube Data API Services</h2>
      <p>LumenSocial uses YouTube Data API Services to upload videos, update video metadata, and manage YouTube content on behalf of authorized accounts.</p>
      <p>When you authorize LumenSocial with your Google Account, we may access information necessary to perform these functions, including:</p>
      <ul>
        <li>YouTube channel information</li>
        <li>Video upload permissions</li>
        <li>Video metadata (titles, descriptions, category)</li>
        <li>Public channel information required for publishing</li>
      </ul>
      <p>LumenSocial only accesses data required to provide the requested functionality and does not access or use YouTube data for any unrelated purposes.</p>
      <p>LumenSocial's use of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" style={{ color: 'var(--accent)' }}>Google API Services User Data Policy</a>, including the Limited Use requirements where applicable.</p>
      <p>Users may review <a href="https://policies.google.com/privacy" style={{ color: 'var(--accent)' }}>Google's Privacy Policy</a> for further information on how Google processes data.</p>

      <h2 style={{ marginTop: '2rem' }}>3B. Revoking Google Account Access</h2>
      <p>You may revoke LumenSocial's access to your Google Account at any time by visiting:</p>
      <p><a href="https://myaccount.google.com/permissions" style={{ color: 'var(--accent)' }}>https://myaccount.google.com/permissions</a></p>
      <p>Revoking access immediately prevents LumenSocial from interacting with your YouTube account or Google Business Profile. Any stored OAuth credentials associated with your Google Account will be removed within a reasonable period following disconnection, unless retention is required by law or for legitimate security purposes.</p>

      <h2 style={{ marginTop: '2rem' }}>3C. Meta (Facebook &amp; Instagram)</h2>
      <p>LumenSocial uses Meta Graph API services to publish approved content to Facebook Pages and Instagram Business accounts connected by the account owner.</p>
      <p>Depending on the permissions granted, LumenSocial may access:</p>
      <ul>
        <li>Connected Pages and Business Accounts</li>
        <li>Post and media publishing permissions</li>
        <li>Basic account information required for publishing</li>
      </ul>
      <p>LumenSocial only accesses information necessary to provide publishing functionality and does not collect Facebook or Instagram passwords.</p>

      <h2 style={{ marginTop: '2rem' }}>3D. LinkedIn</h2>
      <p>LumenSocial uses the LinkedIn Community Management API to publish content on behalf of authorized users.</p>
      <p>Depending on the permissions granted, LumenSocial may access:</p>
      <ul>
        <li>Profile or Organization information</li>
        <li>Publishing permissions</li>
        <li>Post metadata required for publishing</li>
      </ul>
      <p>LumenSocial only uses this information to publish or manage content requested by the authorized account owner.</p>

      <h2 style={{ marginTop: '2rem' }}>3E. TikTok</h2>
      <p>LumenSocial uses the TikTok Content Posting API to publish approved videos to connected TikTok accounts.</p>
      <p>Depending on the permissions granted, LumenSocial may access:</p>
      <ul>
        <li>Account identification</li>
        <li>Video publishing permissions</li>
        <li>Uploaded video metadata</li>
      </ul>
      <p>LumenSocial does not access or store TikTok passwords.</p>

      <h2 style={{ marginTop: '2rem' }}>3F. Google Business Profile</h2>
      <p>LumenSocial uses the Google Business Profile API to publish business updates for authorized business profiles. Information accessed is limited to that required for creating and managing approved business posts.</p>


      <h2 style={{ marginTop: '2rem' }}>3H. Connected Platform Permissions</h2>
      <p>LumenSocial only requests the minimum permissions required for each connected platform. Users remain in control of their connected accounts and may revoke access at any time through either:</p>
      <ul>
        <li>LumenSocial account settings</li>
        <li>The connected platform's own account permissions page</li>
      </ul>

      <h2 style={{ marginTop: '2rem' }}>4. Data Storage and Security</h2>
      <p>Your data is stored securely using Supabase with Row Level Security enabled. OAuth access tokens issued by supported platforms are stored securely as environment variables on Vercel and are never exposed to the client-side application. Tokens are never shared with third parties and are protected using industry-standard security measures including HTTPS encryption in transit and encryption at rest.</p>
      <p>OAuth access tokens are retained only while an account remains connected. Disconnecting a social media account or requesting deletion removes associated authentication credentials within a reasonable period, unless retention is required by law or for legitimate security purposes.</p>

      <h2 style={{ marginTop: '2rem' }}>5. Data Retention</h2>
      <p>Published posts remain in the database for historical reference. AI-generated media URLs may expire based on the generating service's retention policy.</p>
      <p>OAuth access tokens are retained only while an account remains connected. Disconnecting a Google account or requesting deletion removes stored OAuth credentials within a reasonable period, unless retention is required by law.</p>
      <p>You may request deletion of your data at any time by contacting us at privacy@sae963.com.</p>

      <h2 style={{ marginTop: '2rem' }}>6. Your Rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li>Access the personal data we hold about you</li>
        <li>Request correction of inaccurate data</li>
        <li>Request deletion of your data</li>
        <li>Disconnect any linked social media account at any time</li>
        <li>Revoke Google Account authorization at any time through your <a href="https://myaccount.google.com/permissions" style={{ color: 'var(--accent)' }}>Google Account permissions</a></li>
        <li>Withdraw consent for data processing</li>
      </ul>

      <h2 style={{ marginTop: '2rem' }}>7. POPIA Compliance (South Africa)</h2>
      <p>In accordance with the Protection of Personal Information Act (POPIA), we process personal information lawfully, minimally, and with your consent. You may lodge a complaint with the Information Regulator if you believe your rights have been infringed.</p>

      <h2 style={{ marginTop: '2rem' }}>8. Children's Privacy</h2>
      <p>The Services are not intended for individuals under the age of 18. We do not knowingly collect personal information from children.</p>

      <h2 style={{ marginTop: '2rem' }}>9. Changes to This Policy</h2>
      <p>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date.</p>

      <h2 style={{ marginTop: '2rem' }}>10. Contact</h2>
      <p>For privacy-related enquiries or to request data deletion:</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        <li>Email: privacy@sae963.com</li>
        <li>WhatsApp: +27 84 833 1128</li>
        <li>Website: www.sae963.com</li>
      </ul>

      <p style={{ marginTop: '2rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>© 2026 S.A.E&trade; | sae963.com — All rights reserved.</p>
    </div>
  );
}