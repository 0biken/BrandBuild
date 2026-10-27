"use client";

import { useSyncExternalStore } from "react";

/**
 * The email/phone a code was sent to, kept in sessionStorage so it never
 * appears in a URL. Read through useSyncExternalStore so SSR and hydration
 * agree on the fallback.
 */
const KEY = "bb:pending-identifier";
const listeners = new Set<() => void>();

export function setPendingIdentifier(value: string) {
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    /* storage blocked: the Code page falls back to generic copy */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function read(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function usePendingIdentifier(): string {
  return useSyncExternalStore(subscribe, read, () => "");
}
