"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type State<T> = {
  /** URL this state belongs to — data never leaks across URLs. */
  key: string | null;
  data: T | null;
  error: Error | null;
  loading: boolean;
  lastUpdated: number | null;
};

export type PollingOptions<T> = {
  intervalMs?: number;
  /** Server-rendered value for the *current* URL. Used as-is (no fetch) on
   *  first render and whenever the URL changes along with it. */
  initialData?: T;
  /** When false, polling pauses. Default true. */
  enabled?: boolean;
  /** Pause polling while the tab is hidden (default true). */
  pauseWhenHidden?: boolean;
  /** Called after each successful fetch. */
  onSuccess?: (data: T) => void;
};

function fresh<T>(key: string | null, initialData: T | undefined): State<T> {
  return {
    key,
    data: initialData ?? null,
    error: null,
    loading: initialData == null,
    lastUpdated: initialData != null ? Date.now() : null,
  };
}

/**
 * Polling fetcher.
 * - State is keyed by URL: when filters or the exchange change, old data is
 *   dropped immediately (replaced by the new server-rendered `initialData`
 *   when available) instead of lingering until the next poll.
 * - Cancels in-flight requests on URL change / unmount.
 * - Pauses while the tab is hidden and catches up on return.
 */
export function usePolling<T>(url: string | null, opts: PollingOptions<T> = {}) {
  const { intervalMs = 20_000, initialData, enabled = true, pauseWhenHidden = true, onSuccess } = opts;

  const [state, setState] = useState<State<T>>(() => fresh(url, initialData));
  const [seenInitial, setSeenInitial] = useState(initialData);

  // Adjust state during render when the URL (or the server-provided initial
  // value) changes — React's recommended alternative to a reset effect.
  let current = state;
  if (state.key !== url || seenInitial !== initialData) {
    current = state.key !== url || initialData != null ? fresh(url, initialData) : state;
    setState(current);
    setSeenInitial(initialData);
  }

  const abortRef = useRef<AbortController | null>(null);
  const lastUpdatedRef = useRef(current.lastUpdated);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    lastUpdatedRef.current = state.lastUpdated;
  });

  const doFetch = useCallback(async () => {
    if (!url) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState((s) => (s.key === url ? { ...s, loading: true, error: null } : s));
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as T;
      setState({ key: url, data: json, error: null, loading: false, lastUpdated: Date.now() });
      onSuccessRef.current?.(json);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setState((s) => (s.key === url ? { ...s, loading: false, error: e as Error } : s));
    }
  }, [url]);

  const needsInitialFetch = current.data == null;

  // First load for a URL without server data.
  useEffect(() => {
    if (!enabled || !needsInitialFetch) return;
    void doFetch();
  }, [doFetch, enabled, needsInitialFetch]);

  // Interval polling + catch-up when the tab becomes visible again.
  useEffect(() => {
    if (!url || !enabled || intervalMs <= 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (!pauseWhenHidden || document.visibilityState === "visible") await doFetch();
        schedule();
      }, intervalMs);
    };
    schedule();
    const onVis = () => {
      const last = lastUpdatedRef.current;
      if (document.visibilityState === "visible" && (last == null || Date.now() - last > intervalMs)) {
        void doFetch();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      abortRef.current?.abort();
    };
  }, [url, enabled, intervalMs, pauseWhenHidden, doFetch]);

  const { key: _key, ...rest } = current;
  return { ...rest, refetch: doFetch };
}
