import { useEffect, useRef } from 'react';
import { Outlet, NavLink } from 'react-router-dom';

// Custom event fired when the background scheduler releases due posts, so views that list
// scheduled posts (Post History) can refresh without a manual page reload.
export const POSTS_RELEASED_EVENT = 'lumensocial:posts-released';

const TICK_INTERVAL_MS = 60_000;

// Background scheduler ticker.
// Vercel Hobby plans only run the daily /api/cron/post-scheduler cron once per day (at an
// arbitrary minute within the 08:00–08:59 UTC hour), and only for posts already due at that
// instant — so posts approved after the daily fire, or scheduled later in the day, would
// otherwise sit pending until the next day. While a user is logged in, this ticker triggers
// the exact same endpoint every 60s (authenticated with the admin password, which the
// endpoint also accepts) so due posts release within a minute. Concurrency is safe: the
// endpoint claims each post atomically before publishing.
function useSchedulerTicker() {
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (inFlight.current) return; // never overlap runs
      const adminPw = sessionStorage.getItem('lumensocial_pw');
      if (!adminPw) return; // not logged in (AuthGate clears it only via new session, be safe)
      inFlight.current = true;
      try {
        const res = await fetch('/api/cron/post-scheduler', {
          headers: { Authorization: 'Bearer ' + adminPw },
        });
        if (!res.ok) return; // 401 etc. — silently skip; the daily Vercel cron still runs
        const data = await res.json().catch(() => null);
        if (!cancelled && data && typeof data.processed === 'number' && data.processed > 0) {
          window.dispatchEvent(new CustomEvent(POSTS_RELEASED_EVENT, { detail: data }));
        }
      } catch {
        // Network hiccup — the next tick (or the daily cron) will pick up due posts.
      } finally {
        inFlight.current = false;
      }
    }

    tick(); // release anything already overdue the moment the app opens
    const timer = window.setInterval(tick, TICK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
}

export function Layout() {
  useSchedulerTicker();

  return (
    <>
      <nav>
        <div className="nav-brand">LumenSocial</div>
        <div className="nav-links">
          <NavLink to="/app" className={({ isActive }) => isActive ? 'active' : ''} end>
            Autopilot
          </NavLink>
          <NavLink to="/app/history" className={({ isActive }) => isActive ? 'active' : ''}>
            History
          </NavLink>
        </div>
      </nav>
      <div className="container">
        <Outlet />
      </div>
    </>
  );
}