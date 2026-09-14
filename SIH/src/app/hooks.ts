/**
 * Data-fetching and live-stream hooks.
 *
 * Deliberately small — no query library, because the app has a dozen endpoints
 * and adding one would be a dependency we would then have to justify. What it
 * does give every screen for free: a real loading state, a real error state,
 * refetch, and cancellation on unmount so a slow request cannot write into a
 * component that has gone away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client.js';

export interface AsyncState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refetch: () => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn()
      .then((value) => {
        if (!cancelled && alive.current) {
          setData(value);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && alive.current) {
          setError(err instanceof ApiError ? err : new ApiError(String(err), 0, 'unknown'));
        }
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, refetch };
}

// ---------------------------------------------------------------------------
// Live event stream
// ---------------------------------------------------------------------------

export interface LiveEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  at: number;
}

/**
 * Subscribe to the server's SSE feed.
 *
 * EventSource reconnects on its own and the server replays anything missed via
 * Last-Event-ID, so a dropped wifi connection mid-demo recovers silently rather
 * than leaving the dashboard quietly stale — which is the failure mode that
 * actually matters, because a stale dashboard looks exactly like a calm one.
 */
export function useLiveEvents(
  types: string[],
  { enabled = true, limit = 25 }: { enabled?: boolean; limit?: number } = {},
) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource('/api/events');

    const onOpen = () => setConnected(true);
    const onError = () => setConnected(false);
    source.addEventListener('open', onOpen);
    source.addEventListener('error', onError);

    const handlers = types.map((type) => {
      const handler = (raw: Event) => {
        const e = raw as MessageEvent<string>;
        try {
          const payload = JSON.parse(e.data) as Record<string, unknown>;
          setEvents((prev) => [{ id: e.lastEventId || String(Date.now()), type, payload, at: Date.now() }, ...prev].slice(0, limit));
        } catch {
          /* a malformed frame is not worth taking the stream down for */
        }
      };
      source.addEventListener(type, handler);
      return { type, handler };
    });

    return () => {
      source.removeEventListener('open', onOpen);
      source.removeEventListener('error', onError);
      for (const { type, handler } of handlers) source.removeEventListener(type, handler);
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, limit, types.join(',')]);

  return { events, connected, clear: () => setEvents([]) };
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    try {
      const saved = localStorage.getItem('sahara-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* private browsing */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('sahara-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  return { theme, setTheme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

/** Register a global shortcut. Ignores keystrokes typed into inputs. */
export function useHotkey(key: string, handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key.toLowerCase() === key.toLowerCase() && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler, enabled]);
}

/** Poll a fetcher on an interval, pausing while the tab is hidden. */
export function usePolling(fn: () => void, intervalMs: number, enabled = true) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => saved.current(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}
