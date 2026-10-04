import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { POSTS_RELEASED_EVENT } from '../components/Layout';

interface Post {
  id: string;
  content: string;
  media_url: string | null;
  platform: string;
  scheduled_at: string;
  status: string;
  brand: string | null;
  pillar: string | null;
  published_at: string | null;
  error_message: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  threads: 'Threads',
};

function parseYouTubeContent(content: string): { title: string; description: string } | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && parsed.title !== undefined && parsed.description !== undefined) {
      return {
        title: String(parsed.title),
        description: String(parsed.description),
      };
    }
  } catch {
    // Keep plain-text rendering for non-JSON content.
  }
  return null;
}

export function PostHistory() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchPosts();
  }, [filter]);

  // Refresh automatically when the background scheduler (Layout ticker or daily cron)
  // releases due posts, so newly published/failed rows appear without a manual reload.
  useEffect(() => {
    const onPostsReleased = () => { fetchPosts(); };
    window.addEventListener(POSTS_RELEASED_EVENT, onPostsReleased);
    return () => window.removeEventListener(POSTS_RELEASED_EVENT, onPostsReleased);
  });

  async function fetchPosts() {
    setLoading(true);
    let query = supabase
      .from('scheduled_posts')
      .select('*')
      .order('scheduled_at', { ascending: false })
      .limit(100);

    if (filter === 'published') query = query.eq('status', 'published');
    else if (filter === 'failed') query = query.eq('status', 'failed');
    else if (filter === 'pending') query = query.eq('status', 'pending');
    else if (filter === 'rejected') query = query.eq('status', 'rejected');
    if (filter === 'all') query = query.neq('status', 'draft');

    const { data } = await query;
    if (data) setPosts(data);
    setLoading(false);
  }

  async function handleReleaseNow(post: Post) {
    const label = PLATFORM_LABELS[post.platform] || post.platform;
    if (!confirm('Release this ' + label + ' post immediately?')) return;
    setReleasingId(post.id);
    try {
      const adminPw = sessionStorage.getItem('lumensocial_pw') || '';
      const res = await fetch('/api/release-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminPw },
        body: JSON.stringify({ id: post.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        await fetchPosts();
      } else {
        alert('Release failed: ' + (data.error || res.statusText));
        await fetchPosts();
      }
    } catch (err) {
      alert('Request failed: ' + err);
    }
    setReleasingId(null);
  }

  async function handleDelete(post: Post) {
    const label = PLATFORM_LABELS[post.platform] || post.platform;
    if (!confirm('Delete this ' + label + ' post? This cannot be undone.')) return;
    setDeletingId(post.id);
    await supabase.from('scheduled_posts').delete().eq('id', post.id);
    await fetchPosts();
    setDeletingId(null);
  }

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Post History</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {['all', 'published', 'pending', 'failed', 'rejected'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="btn"
            style={{
              background: filter === f ? 'var(--accent)' : 'var(--surface)',
              color: filter === f ? 'white' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-muted)' }}>
          <span className="spinner" />
          <span>Loading...</span>
        </div>
      )}

      {!loading && posts.length === 0 && (
        <div className="card">
          <p style={{ color: 'var(--text-muted)' }}>No posts found with this filter.</p>
        </div>
      )}

      <div className="posts-list">
        {posts.map((post) => {
          const youtubeContent = post.platform === 'youtube' ? parseYouTubeContent(post.content) : null;
          return (
          <div key={post.id} className="card" style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.75rem', flexWrap: 'wrap' }}>
              <span className={`status-badge status-${post.status}`}>{post.status}</span>
              <span className="status-badge status-pending">{PLATFORM_LABELS[post.platform] || post.platform}</span>
              {post.brand && <span style={{ color: 'var(--accent)' }}>{post.brand}</span>}
              {post.pillar && <span style={{ color: 'var(--text-muted)' }}>{post.pillar}</span>}
            </div>

            {youtubeContent ? (
              <div style={{ marginBottom: '0.75rem' }}>
                <p style={{ marginBottom: '0.25rem', fontWeight: 600 }}>{youtubeContent.title}</p>
                <p style={{ marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Description</p>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5', color: 'var(--text-muted)' }}>
                  {youtubeContent.description}
                </p>
              </div>
            ) : (
              <p style={{ marginBottom: '0.75rem', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{post.content}</p>
            )}

            {post.media_url && (
              <div style={{ marginBottom: '0.75rem' }}>
                {post.media_url.includes('/video/') ? (
                  <video src={post.media_url} controls style={{ maxWidth: '250px', borderRadius: '6px' }} />
                ) : (
                  <img src={post.media_url} alt="" style={{ maxWidth: '150px', borderRadius: '6px' }} />
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <span>Scheduled: {new Date(post.scheduled_at).toLocaleString()}</span>
                {post.published_at && <span>Published: {new Date(post.published_at).toLocaleString()}</span>}
              </div>

              {post.status === 'pending' && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleReleaseNow(post)}
                    className="btn btn-primary"
                    style={{ fontSize: '0.8rem' }}
                    disabled={releasingId === post.id || deletingId === post.id}
                  >
                    {releasingId === post.id
                      ? <><span className="spinner" style={{ width: '12px', height: '12px', marginRight: '0.375rem' }} />Releasing...</>
                      : 'Release Now'}
                  </button>
                  <button
                    onClick={() => handleDelete(post)}
                    className="btn"
                    style={{ background: '#2d0606', color: 'var(--error)', fontSize: '0.8rem', border: '1px solid var(--error)' }}
                    disabled={releasingId === post.id || deletingId === post.id}
                  >
                    {deletingId === post.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              )}
            </div>

            {post.error_message && (
              <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>{post.error_message}</p>
            )}
          </div>
        )})}
      </div>
    </div>
  );
}