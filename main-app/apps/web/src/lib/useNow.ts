"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * The current time on the client, null during SSR and hydration, so
 * time-dependent text (greetings, today's date) never mismatches.
 */
export function useNow(): Date | null {
  const ms = useSyncExternalStore(noop, getMinute, () => null);
  return ms === null ? null : new Date(ms);
}

// Rounded to the minute so the snapshot is stable between renders.
const getMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

export function greeting(d: Date): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
