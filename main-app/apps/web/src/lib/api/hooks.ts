"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ApiError, ApiResult } from "./types";

/**
 * Minimal data hook. Keys are strings like "posts" or "posts:abc"; calling
 * invalidate("posts") refetches every query whose key starts with "posts".
 * Swap for TanStack Query if caching needs grow.
 */

const versions = new Map<string, number>();
const listeners = new Set<() => void>();

export function invalidate(prefix: string) {
  for (const key of new Set([...versions.keys(), prefix])) {
    if (key.startsWith(prefix)) versions.set(key, (versions.get(key) ?? 0) + 1);
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

type Settled<T> = { tag: string; data?: T; error?: ApiError };

export type Query<T> = {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  refetch: () => void;
};

export function useQuery<T>(key: string, fetcher: () => Promise<ApiResult<T>>): Query<T> {
  const version = useSyncExternalStore(
    subscribe,
    () => versions.get(key) ?? 0,
    () => 0,
  );
  const tag = `${key}#${version}`;
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let live = true;
    fetcher().then((res) => {
      if (!live) return;
      setSettled(res.ok ? { tag, data: res.data } : { tag, error: res.error });
    });
    return () => {
      live = false;
    };
    // The fetcher is keyed by `key`; a new closure each render must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  const refetch = useCallback(() => invalidate(key), [key]);
  // Keep showing the last data while a refetch is in flight.
  const fresh = settled?.tag === tag;
  return {
    data: settled?.data,
    error: fresh ? settled?.error : undefined,
    loading: !fresh,
    refetch,
  };
}
