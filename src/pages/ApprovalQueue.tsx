import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface DraftPost {
  id: string;
  content: string;
  media_url: string | null;
  media_urls: string | null;
  video_url: string | null;
  platform: string;
  scheduled_at: string;
  status: string;
  brand: string | null;
  pillar: string | null;
  created_at: string;
  // MyMarky source id with the platform suffix, e.g. "abc123_linkedin". Null for posts written by
  // hand rather than pulled. REJECT needs it to find the ledger entry for the source post.
  mymarky_id?: string | null;
}

interface MediaItem {
  id: string;
  type: string;
  url: string;
  prompt: string;
  brand: string;
  created_at: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube',
};

const PLATFORM_LIMITS: Record<string, { charLimit: number; maxImages: number; mediaType: string }> = {
  linkedin: { charLimit: 3000, maxImages: 20, mediaType: 'both' },
  facebook: { charLimit: 63206, maxImages: 3, mediaType: 'both' },
  instagram: { charLimit: 2200, maxImages: 10, mediaType: 'both' },
  // YouTube accepts a video only - no still images - and its description cap is 5000 characters.
  youtube: { charLimit: 5000, maxImages: 0, mediaType: 'video' },
};
export function ApprovalQueue() {
  const [drafts, setDrafts] = useState<DraftPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [pullResult, setPullResult] = useState<any>(null);
  const [pullMode, setPullMode] = useState<'fresh' | 'force' | 'reset'>('fresh');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  // YouTube is the only platform whose text is a heading PLUS a body. Everything else is one
  // caption, so this stays empty for them and never reaches the database.
  const [editTitle, setEditTitle] = useState('');
  const [editMediaUrls, setEditMediaUrls] = useState<string[]>([]);
  const [editVideoUrl, setEditVideoUrl] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryItems, setLibraryItems] = useState<MediaItem[]>([]);
  const [libraryType, setLibraryType] = useState<'image' | 'video'>('image');
  const [uploading, setUploading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any>(null);
  const [probeBrand, setProbeBrand] = useState<'sae' | 'tessera' | 'hoaws'>('sae');
  const [pullDays, setPullDays] = useState(10);
  // How far back to accept MyMarky material, in days. Anything older is skipped. 0 = no limit.
  const [pullSinceDays, setPullSinceDays] = useState(30);
  // The most recent row removed by DELETE, held so a mis-click is reversible. Persisted for this
  // browser session only - it is a safety net, not a recycle bin, and deliberately never touches
  // the mymarky_seen ledger (restoring must not re-import or duplicate anything).
  const [lastDeleted, setLastDeleted] = useState<DraftPost | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('lumen_last_deleted');
      if (raw) setLastDeleted(JSON.parse(raw));
    } catch { /* corrupt or unavailable storage - start with no undo available */ }
  }, []);

  // Asks MyMarky what its posts endpoint actually returns, instead of inferring it. The pull can
  // only report what it read - when every brand reports the same 60 posts with no cursor, this is
  // the only way to tell a capped page from a genuinely small account.
  async function handleProbe() {
    setProbing(true);
    setProbeResult(null);
    const probeCancel = new AbortController();
    const probeTimer = window.setTimeout(() => probeCancel.abort(), 45000);
    try {
      const adminPw = sessionStorage.getItem('lumensocial_pw') || '';
      const res = await fetch('/api/mymarky-probe?brand=' + probeBrand, {
        method: 'POST',
        headers: { 'x-admin-password': adminPw },
        // Hard client-side stop via AbortController. The server bounds each MyMarky call, but if the
        // function itself never responds the button must still recover rather than spin forever.
        // AbortController, not AbortSignal.timeout(): that static is missing in older browsers and
        // throwing there would abort before the fetch even starts, leaving a stuck spinner.
        signal: probeCancel.signal,
      });
      const data = await res.json().catch(() => null);
      setProbeResult(data || { error: 'No response from server (HTTP ' + res.status + ')' });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      setProbeResult({
        error: timedOut
          ? 'Stopped after 45 seconds with no answer from the server. Check the Vercel function log for /api/mymarky-probe.'
          : 'Request failed: ' + (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      // Always clear the spinner, whatever happened above.
      window.clearTimeout(probeTimer);
      setProbing(false);
    }
  }

  async function handlePullMymarky() {
    setPulling(true);
    setPullResult(null);
    // AbortController + setTimeout rather than AbortSignal.timeout(). The timeout static is missing
    // in older browsers and, when it throws, the handler aborts before it reaches the fetch - which
    // is how a "why is this stuck" bug gets misread as a server-side failure.
    const pullCancel = new AbortController();
    const pullTimer = window.setTimeout(() => pullCancel.abort(), 90000);
    try {
      const adminPw = sessionStorage.getItem('lumensocial_pw') || '';
      const params = new URLSearchParams({
        days: String(pullDays),
        since_days: String(pullSinceDays),
        mode: pullMode,
      });

      const res = await fetch('/api/pull-mymarky?' + params.toString(), {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + adminPw, 'Content-Type': 'application/json' },
        // The pull can legitimately take a while over three brands, but it must never hang the
        // button forever. No signal support relied on: AbortController works in every browser.
        signal: pullCancel.signal,
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setPullResult(data);
        alert('Imported ' + (data.imported || 0) + ' posts from Mymarky!');
        fetchDrafts();
      } else {
        setPullResult(data || { error: res.statusText });
        alert('Pull failed: ' + (data?.error || res.statusText));
      }
    } catch (err) {
      const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
      alert(aborted
        ? 'Pull timed out after 90 seconds. Check the Vercel function logs before retrying.'
        : 'Request failed: ' + err);
    }
    window.clearTimeout(pullTimer);
    setPulling(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('brand', '');
      const res = await fetch('/api/upload-media', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) {
        if (type === 'video') setEditVideoUrl(data.url);
        else setEditMediaUrls(prev => [...prev, data.url]);
      } else {
        alert('Upload failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) { alert('Upload failed: ' + err); }
    setUploading(false);
    e.target.value = '';
  }

  useEffect(() => { fetchDrafts(); }, []);

  async function fetchDrafts() {
    setLoading(true);
    const { data } = await supabase
      .from('scheduled_posts').select('*').eq('status', 'draft')
      .order('scheduled_at', { ascending: true });
    if (data) setDrafts(data);
    setLoading(false);
  }

  async function fetchLibrary(type: 'image' | 'video') {
    setLibraryType(type);
    const { data } = await supabase
      .from('media_library').select('*').eq('type', type)
      .order('created_at', { ascending: false }).limit(50);
    if (data) setLibraryItems(data as MediaItem[]);
    setShowLibrary(true);
  }

  async function handleApprove(id: string) {
    await supabase.from('scheduled_posts')
      .update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', id);
    fetchDrafts();
  }

  async function handleApproveAll() {
    const ids = drafts.map(d => d.id);
    await supabase.from('scheduled_posts')
      .update({ status: 'pending', updated_at: new Date().toISOString() }).in('id', ids);
    fetchDrafts();
  }

  // REJECT and DELETE are opposites, and that is the whole point.
  //
  //   REJECT  = "not this one, send it back" - the rows go away AND the mymarky_seen ledger entry
  //             is released, so the next pull fetches the source post again.
  //   DELETE  = "never use this" - the row goes away and the ledger entry stays, so the source post
  //             is permanently excluded. Undo below covers an accidental click.
  //
  // The ledger is only released when the LAST copy of that source post leaves Lumen. One MyMarky
  // post fans out to a row per platform, so rejecting just the LinkedIn copy while Facebook and
  // Instagram are still queued must NOT make the whole post pullable again - it is still here.
  async function handleReject(id: string) {
    const row = drafts.find(d => d.id === id);
    await supabase.from('scheduled_posts').delete().eq('id', id);

    const sourceId = sourcePostId(row);
    if (sourceId && row?.brand) {
      const { data: stillHere } = await supabase
        .from('scheduled_posts')
        .select('id, mymarky_id')
        .eq('brand', row.brand)
        .not('mymarky_id', 'is', null);
      const copiesLeft = (stillHere || []).filter(r => {
        const m = r.mymarky_id as string | null;
        return !!m && (m === sourceId || m.startsWith(sourceId + '_'));
      });
      if (copiesLeft.length === 0) {
        await supabase
          .from('mymarky_seen')
          .delete()
          .eq('mymarky_id', sourceId)
          .eq('brand', row.brand);
      }
    }
    fetchDrafts();
  }

  async function handleDelete(id: string) {
    const row = drafts.find(d => d.id === id);
    await supabase.from('scheduled_posts').delete().eq('id', id);
    if (row) {
      setLastDeleted(row);
      try { sessionStorage.setItem('lumen_last_deleted', JSON.stringify(row)); } catch { /* ignore */ }
    }
    fetchDrafts();
  }

  // Put back exactly what was deleted, with its original id. The ledger entry was never touched,
  // so this restores the scheduled row - it does not re-import and cannot duplicate.
  async function handleUndoDelete() {
    if (!lastDeleted) return;
    const { error } = await supabase.from('scheduled_posts').insert(lastDeleted);
    if (error) {
      alert('Could not restore that post: ' + error.message);
      return;
    }
    setLastDeleted(null);
    try { sessionStorage.removeItem('lumen_last_deleted'); } catch { /* ignore */ }
    fetchDrafts();
  }

  // MyMarky stores the source id as "<source>_<platform>". Strip the suffix we know was appended
  // rather than splitting on "_" - MyMarky ids can themselves contain underscores.
  function sourcePostId(row?: DraftPost | null): string | null {
    if (!row?.mymarky_id) return null;
    const suffix = '_' + row.platform;
    return row.mymarky_id.endsWith(suffix)
      ? row.mymarky_id.slice(0, row.mymarky_id.length - suffix.length)
      : row.mymarky_id;
  }

  function startEdit(post: DraftPost) {
    setEditingId(post.id);
    setEditVideoUrl(post.video_url || '');
    try {
      setEditMediaUrls(post.media_urls ? JSON.parse(post.media_urls) : (post.media_url ? [post.media_url] : []));
    } catch { setEditMediaUrls(post.media_url ? [post.media_url] : []); }

    if (post.platform !== 'youtube') {
      setEditTitle('');
      setEditContent(post.content);
      return;
    }

    // YouTube content is either JSON {"title","description"} or the plain text the pull writes.
    // Either way both boxes are filled, so the editor always shows the heading YouTube will
    // actually use instead of forcing the user to edit raw JSON to get at it.
    const parsed = parseYouTubeContent(post.content);
    if (parsed) {
      setEditTitle(parsed.title || '');
      setEditContent(parsed.description || '');
    } else {
      // Plain text: mirror exactly what the connector derives - title = first 100 chars,
      // description = the whole string. Saving that back as JSON is a no-op behaviourally,
      // but it makes the heading independently editable from then on.
      setEditTitle(post.content.substring(0, 100));
      setEditContent(post.content);
    }
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    // YouTube stores the heading and body as JSON {"title","description"} so the heading survives
    // independently. A blank heading falls back to plain text rather than JSON with an empty
    // title - otherwise the connector would derive its title from the literal string
    // '{"title":""...' and the video would be published with garbage for a heading.
    const editingPost = drafts.find(d => d.id === editingId);
    const isYoutube = editingPost?.platform === 'youtube';
    const title = editTitle.trim();
    const content = isYoutube && title
      ? JSON.stringify({ title, description: editContent })
      : editContent;

    await supabase.from('scheduled_posts').update({
      content,
      media_url: editVideoUrl || editMediaUrls[0] || null,
      media_urls: JSON.stringify(editMediaUrls),
      video_url: editVideoUrl || null,
      updated_at: new Date().toISOString(),
    }).eq('id', editingId);
    setEditingId(null);
    fetchDrafts();
  }

  function selectFromLibrary(url: string) {
    if (libraryType === 'video') {
      setEditVideoUrl(url);
    } else {
      setEditMediaUrls(prev => [...prev, url]);
    }
    setShowLibrary(false);
  }

  function removeImage(index: number) {
    setEditMediaUrls(prev => prev.filter((_, i) => i !== index));
  }



  const groupedDrafts = drafts.reduce<Record<string, DraftPost[]>>((acc, post) => {
    const dateKey = new Date(post.scheduled_at).toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(post);
    return acc;
  }, {});

  function parseYouTubeContent(content: string): { title: string; description: string } | null {
    try {
      const parsed = JSON.parse(content);
      if (parsed.title !== undefined && parsed.description !== undefined) return parsed;
    } catch {}
    return null;
  }

  function getMediaUrls(post: DraftPost): string[] {
    try { return post.media_urls ? JSON.parse(post.media_urls) : (post.media_url ? [post.media_url] : []); }
    catch { return post.media_url ? [post.media_url] : []; }
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <h1>Autopilot</h1>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {/* Troubleshooting only: reveals what MyMarky really returns, so a "0 imported" result
              can be explained instead of guessed at. */}
          <select
            value={probeBrand}
            onChange={e => setProbeBrand(e.target.value as 'sae' | 'tessera' | 'hoaws')}
            style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          >
            <option value="sae">S.A.E Method</option>
            <option value="tessera">Tessera Lumen</option>
            <option value="hoaws">HOAWS</option>
          </select>
          <button onClick={handleProbe} className="btn" style={{ background: 'var(--border)', color: 'var(--text)' }} disabled={probing}>
            {probing ? <span className="spinner" /> : null}
            {probing ? 'Checking...' : 'Check MyMarky'}
          </button>
          <button onClick={handlePullMymarky} className="btn" style={{ background: 'var(--border)', color: 'var(--text)' }} disabled={pulling}>
            {pulling ? <span className="spinner" /> : null}
            {pulling ? 'Pulling...' : 'Pull Week from Mymarky'}
          </button>
        </div>
      </div>

      {drafts.length > 0 && (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button onClick={handleApproveAll} className="btn btn-primary">Approve All ({drafts.length})</button>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{drafts.length} drafts pending review</span>
        </div>
      )}

      {lastDeleted && (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={handleUndoDelete} className="btn" style={{ background: 'var(--border)', color: 'var(--text)' }}>
            Undo last delete
          </button>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {PLATFORM_LABELS[lastDeleted.platform] || lastDeleted.platform}
            {lastDeleted.brand ? ' · ' + lastDeleted.brand : ''}
            {' · '}{new Date(lastDeleted.scheduled_at).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}
            {' '}— restores the row without re-pulling it.
          </span>
        </div>
      )}

      {loading && <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-muted)' }}><span className="spinner" /><span>Loading...</span></div>}
      {!loading && drafts.length === 0 && <div className="card"><p style={{ color: 'var(--text-muted)' }}>No drafts. Click "Generate Next Week" or generate media first in Images/Video tabs.</p></div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontWeight: 600 }}>MyMarky pull mode</label>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="radio" name="mymarky-mode" checked={pullMode === 'fresh'} onChange={() => setPullMode('fresh')} />
              Fresh pull
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="radio" name="mymarky-mode" checked={pullMode === 'reset'} onChange={() => setPullMode('reset')} />
              Reset queue & pull fresh
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="radio" name="mymarky-mode" checked={pullMode === 'force'} onChange={() => setPullMode('force')} />
              Force (allows duplicates)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Only material created in last:</span>
              <input
                type="number"
                min={0}
                max={365}
                value={pullSinceDays}
                onChange={e => setPullSinceDays(Math.min(365, Math.max(0, parseInt(e.target.value) || 0)))}
                style={{ width: '3.5rem', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', textAlign: 'center' }}
              />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>days</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Days to schedule:</span>
              <input
                type="number"
                min={1}
                max={25}
                value={pullDays}
                onChange={e => setPullDays(Math.min(25, Math.max(1, parseInt(e.target.value) || 1)))}
                style={{ width: '3.5rem', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', textAlign: 'center' }}
              />
            </label>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>
            Fresh pull imports only new material: never anything already pulled (even if you deleted it), never anything already released.{' '}
            <strong>Reset</strong> first deletes unpublished MyMarky posts from the queue, then pulls. Published posts and the already-pulled
            record are kept.{' '}
            <strong>Force</strong> ignores the already-pulled check and will create duplicates.{' '}
            <strong>Days</strong> is how many weekday slots to fill per brand.{' '}
            <strong>Only material created in last N days</strong> rejects anything older than N (default 30; set 0 to disable).
          </p>
        </div>
      </div>

      {probeResult && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>MyMarky Check — {probeBrand.toUpperCase()}</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0 }}>
            What MyMarky actually returns for this account. Plain-language summary first, raw detail below.
          </p>
          {/* The answer itself, not raw JSON. One sentence that decides between "more material
              exists behind page 1" and "this account genuinely holds nothing newer". */}
          {probeResult.verdict && (
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '6px',
                marginBottom: '1rem',
                fontSize: '0.95rem',
                fontWeight: 600,
                background: probeResult.verdict.startsWith('FOUND IT') ? 'rgba(220, 180, 40, 0.18)' : 'rgba(120, 200, 140, 0.15)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            >
              {probeResult.verdict}
            </div>
          )}
          {probeResult.elapsedSec && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Took {probeResult.elapsedSec}s.
            </p>
          )}
          {Array.isArray(probeResult.results) && (
            <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '0.3rem' }}>Query</th>
                    <th style={{ padding: '0.3rem' }}>HTTP</th>
                    <th style={{ padding: '0.3rem' }}>Posts returned</th>
                    <th style={{ padding: '0.3rem' }}>More pages?</th>
                    <th style={{ padding: '0.3rem' }}>Newest post date</th>
                  </tr>
                </thead>
                <tbody>
                  {probeResult.results.map((r: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.3rem' }}>{r.query}</td>
                      <td style={{ padding: '0.3rem' }}>{r.httpStatus ?? r.error ?? '-'}</td>
                      <td style={{ padding: '0.3rem', fontWeight: r.returnedCount > 60 ? 'bold' : 'normal' }}>
                        {r.returnedCount ?? '-'}
                      </td>
                      <td style={{ padding: '0.3rem' }}>
                        {r.hasMore === true ? 'YES' : r.hasMore === false ? 'no' : (r.cursorFieldsPresent?.length ? 'field: ' + r.cursorFieldsPresent.join(', ') : '-')}
                      </td>
                      <td style={{ padding: '0.3rem' }}>{r.sampleDates?.[0]?.created_at || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* The workspace question: S.A.E/Tessera's configured workspace is ~70 days stale, so
              list every workspace this API key can see and age each one. If the new material
              lives in another workspace, this is where it shows up. */}
          {Array.isArray(probeResult.workspaces) && probeResult.workspaces.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                Workspaces this API key can see
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '0.3rem' }}>Workspace</th>
                    <th style={{ padding: '0.3rem' }}>Posts</th>
                    <th style={{ padding: '0.3rem' }}>Newest post</th>
                    <th style={{ padding: '0.3rem' }}>Age (days)</th>
                    <th style={{ padding: '0.3rem' }}>Importable in window</th>
                  </tr>
                </thead>
                <tbody>
                  {probeResult.workspaces.map((w: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.3rem' }}>
                        {w.name}
                        {w.configured && <span style={{ color: 'var(--accent)' }}> (reading this one)</span>}
                        {w.error && <span style={{ color: '#d66' }}> — {w.error}</span>}
                      </td>
                      <td style={{ padding: '0.3rem' }}>{w.count ?? '-'}</td>
                      <td style={{ padding: '0.3rem' }}>{w.newestCreated || '-'}</td>
                      <td style={{ padding: '0.3rem', fontWeight: w.newestAgeDays != null && w.newestAgeDays <= 30 ? 'bold' : 'normal' }}>
                        {w.newestAgeDays ?? '-'}
                      </td>
                      <td style={{ padding: '0.3rem', fontWeight: w.importableNow > 0 ? 'bold' : 'normal', color: w.importableNow > 0 ? 'var(--accent)' : undefined }}>
                        {w.importableNow ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Show raw response</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', color: 'var(--text-muted)', maxHeight: '20rem', overflow: 'auto' }}>
              {JSON.stringify(probeResult, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {pullResult && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>MyMarky Pull Diagnostics</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {JSON.stringify(pullResult, null, 2)}
          </pre>
        </div>
      )}

      {/* Media Library Picker Modal */}
      {showLibrary && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="card" style={{ maxWidth: '600px', width: '100%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.125rem' }}>Pick from {libraryType === 'image' ? 'Image' : 'Video'} Library</h2>
              <button onClick={() => setShowLibrary(false)} className="btn" style={{ background: 'var(--border)', color: 'var(--text)' }}>Close</button>
            </div>
            {libraryItems.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No {libraryType}s in library. Go to the {libraryType === 'image' ? 'Images' : 'Video'} tab to generate some.</p>}
            <div style={{ display: 'grid', gridTemplateColumns: libraryType === 'image' ? 'repeat(auto-fill, minmax(100px, 1fr))' : '1fr', gap: '0.5rem' }}>
              {libraryItems.map(item => (
                <div key={item.id} onClick={() => selectFromLibrary(item.url)} style={{ cursor: 'pointer', border: '2px solid transparent', borderRadius: '6px', transition: 'border-color 0.15s' }} onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--accent)')} onMouseOut={e => (e.currentTarget.style.borderColor = 'transparent')}>
                  {libraryType === 'image' ? (
                    <img src={item.url} alt={item.prompt} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '4px' }} />
                  ) : (
                    <video src={item.url} controls style={{ width: '100%', borderRadius: '4px' }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {Object.entries(groupedDrafts).map(([dateKey, posts]) => (
        <div key={dateKey} style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>{dateKey}</h2>
          <div className="posts-list">
            {posts.map(post => {
              const limits = PLATFORM_LIMITS[post.platform];
              const mediaUrls = getMediaUrls(post);
              const isEditing = editingId === post.id;
              const youtubeContent = post.platform === 'youtube' ? parseYouTubeContent(post.content) : null;

              return (
                <div key={post.id} className="card" style={{ marginBottom: '0.75rem' }}>
                  {isEditing ? (
                    <div>
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.75rem' }}>
                        <span className="status-badge status-pending">{PLATFORM_LABELS[post.platform]}</span>
                        {post.brand && <span style={{ color: 'var(--accent)' }}>{post.brand}</span>}
                        <span style={{ color: 'var(--text-muted)' }}>Max {limits?.charLimit} chars | {limits?.mediaType === 'video' ? 'Video' : 'Max ' + limits?.maxImages + ' images'}</span>
                      </div>
                      <div className="form-group">
                        {post.platform === 'youtube' ? (
                          <>
                            <label>Title ({editTitle.length}/100)</label>
                            <input
                              type="text"
                              value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              maxLength={100}
                              placeholder="YouTube video heading — max 100 characters"
                              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', marginBottom: '0.6rem', boxSizing: 'border-box' }}
                            />
                            <label>Description ({editContent.length}/{limits?.charLimit || '?'})</label>
                            <textarea className="textarea" value={editContent} onChange={e => setEditContent(e.target.value)}
                              style={{ borderColor: editContent.length > (limits?.charLimit || 9999) ? 'var(--error)' : undefined }} />
                          </>
                        ) : (
                          <>
                            <label>Caption ({editContent.length}/{limits?.charLimit || '?'})</label>
                            <textarea className="textarea" value={editContent} onChange={e => setEditContent(e.target.value)}
                              style={{ borderColor: editContent.length > (limits?.charLimit || 9999) ? 'var(--error)' : undefined }} />
                          </>
                        )}
                      </div>

                      {limits?.mediaType !== 'video' && (
                        <div style={{ marginBottom: '0.75rem' }}>
                          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.375rem' }}>Images ({editMediaUrls.length}/{limits?.maxImages || 3})</label>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                            {editMediaUrls.map((url, i) => (
                              <div key={i} style={{ position: 'relative' }}>
                                <img src={url} alt="" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px' }} />
                                <button onClick={() => removeImage(i)} style={{ position: 'absolute', top: '-4px', right: '-4px', background: 'var(--error)', color: 'white', border: 'none', borderRadius: '50%', width: '18px', height: '18px', cursor: 'pointer', fontSize: '0.6rem' }}>X</button>
                              </div>
                            ))}
                          </div>
                          <button onClick={() => fetchLibrary('image')} className="btn" style={{ background: 'var(--border)', color: 'var(--text)', fontSize: '0.8rem' }} disabled={editMediaUrls.length >= (limits?.maxImages || 3)}>
                            Pick from Library
                          </button>
                          <label className="btn" style={{ background: 'var(--border)', color: 'var(--text)', fontSize: '0.8rem', cursor: 'pointer' }}>
                            {uploading ? 'Uploading...' : 'Upload from PC'}
                            <input type="file" accept="image/*" onChange={e => handleUpload(e, 'image')} style={{ display: 'none' }} disabled={uploading || editMediaUrls.length >= (limits?.maxImages || 3)} />
                          </label>
                        </div>
                      )}

                      {(limits?.mediaType === 'video' || limits?.mediaType === 'both') && (
                        <div style={{ marginBottom: '0.75rem' }}>
                          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.375rem' }}>Video</label>
                          {editVideoUrl && <video src={editVideoUrl} controls style={{ maxWidth: '200px', borderRadius: '6px', marginBottom: '0.5rem', display: 'block' }} />}
                          <button onClick={() => fetchLibrary('video')} className="btn" style={{ background: 'var(--border)', color: 'var(--text)', fontSize: '0.8rem' }}>
                            {editVideoUrl ? 'Change Video' : 'Pick from Library'}
                          </button>
                          <label className="btn" style={{ background: 'var(--border)', color: 'var(--text)', fontSize: '0.8rem', cursor: 'pointer' }}>
                            {uploading ? 'Uploading...' : 'Upload from PC'}
                            <input type="file" accept="video/*" onChange={e => handleUpload(e, 'video')} style={{ display: 'none' }} disabled={uploading} />
                          </label>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={handleSaveEdit} className="btn btn-primary">Save</button>
                        <button onClick={() => setEditingId(null)} className="btn" style={{ background: 'var(--border)', color: 'var(--text)' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.75rem' }}>
                        <span className="status-badge status-pending">{PLATFORM_LABELS[post.platform] || post.platform}</span>
                        {post.brand && <span style={{ color: 'var(--accent)' }}>{post.brand}</span>}
                        {post.pillar && <span style={{ color: 'var(--text-muted)' }}>{post.pillar}</span>}
                      </div>
                      {youtubeContent ? (
                        <div style={{ marginBottom: '0.75rem' }}>
                          <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{youtubeContent.title}</p>
                          <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5', color: 'var(--text-muted)', fontSize: '0.875rem' }}>{youtubeContent.description}</p>
                        </div>
                      ) : (
                        <p style={{ marginBottom: '0.75rem', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{post.content}</p>
                      )}
                      {post.video_url && <video src={post.video_url} controls style={{ maxWidth: '200px', borderRadius: '6px', marginBottom: '0.75rem', display: 'block' }} />}
                      {mediaUrls.length > 0 && !post.video_url && (
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                          {mediaUrls.map((url, i) => <img key={i} src={url} alt="" style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '6px' }} />)}
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(post.scheduled_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => startEdit(post)} className="btn" style={{ background: 'var(--border)', color: 'var(--text)', fontSize: '0.8rem' }}>Edit</button>
                          <button onClick={() => handleApprove(post.id)} className="btn btn-primary" style={{ fontSize: '0.8rem' }}>Approve</button>
                          <button onClick={() => handleReject(post.id)} className="btn" style={{ background: '#2d0606', color: 'var(--error)', fontSize: '0.8rem' }}>Reject</button>
                          <button onClick={() => handleDelete(post.id)} className="btn" style={{ background: 'transparent', color: 'var(--text-muted)', fontSize: '0.8rem', border: '1px solid var(--border)' }}>Delete</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}