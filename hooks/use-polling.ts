"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type State<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
  lastUpdated: number | null;
};

export type PollingOptions<T> = {
  intervalMs?: number;
  /** Initial value (e.g. server-rendered). Skips first fetch if provided. */
  initialData?: T;
  /** When false, polling pauses. Default true. */
  enabled?: boolean;
  /** Pause polling while tab is hidden (default true). */
  pauseWhenHidden?: boolean;
  /** Called after each successful fetch. */
  onSuccess?: (data: T) => void;
};

/**
 * Lightweight polling fetcher — no external dep.
 * - Cancels in-flight requests on URL change.
 * - Pauses when the browser tab is hidden (via visibilitychange).
 * - Returns refetch() for manual refresh.
 */
export function usePolling<T>(
  url: string | null,
  opts: PollingOptions<T> = {},
) {
  const {
    intervalMs = 20_000,
    initialData,
    enabled = true,
    pauseWhenHidden = true,
    onSuccess,
  } = opts;

  const [state, setState] = useState<State<T>>({
    data: initialData ?? null,
    error: null,
    loading: initialData == null,
    lastUpdated: initialData ? Date.now() : null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest deps for the fetcher without re-creating it on every render
  const urlRef = useRef(url);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const doFetch = useCallback(async () => {
    const current = urlRef.current;
    if (!current) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await fetch(current, { signal: ac.signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as T;
      setState({
        data: json,
        error: null,
        loading: false,
        lastUpdated: Date.now(),
      });
      onSuccessRef.current?.(json);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setState((s) => ({
        ...s,
        loading: false,
        error: e as Error,
      }));
    }
  }, []);

  // URL changes → fetch fresh (even if we have initialData)
  useEffect(() => {
    if (!url || !enabled) return;
    // If no initial data OR url has changed from what initial data represents,
    // fetch immediately. Simplest: always fetch on url change except first render with initialData.
    if (state.data == null || state.lastUpdated == null) {
      doFetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled]);

  // Interval polling
  useEffect(() => {
    if (!url || !enabled || intervalMs <= 0) return;

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        if (!pauseWhenHidden || document.visibilityState === "visible") {
          await doFetch();
        }
        schedule();
      }, intervalMs);
    };

    schedule();

    const onVis = () => {
      if (
        document.visibilityState === "visible" &&
        state.lastUpdated != null &&
        Date.now() - state.lastUpdated > intervalMs
      ) {
        doFetch();
      }
    };

    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVis);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, intervalMs]);

  return {
    ...state,
    refetch: doFetch,
  };
}
