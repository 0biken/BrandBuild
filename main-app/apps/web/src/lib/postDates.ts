import type { PostItem } from "@/lib/api/types";

/**
 * Helpers for the sample data's display strings ("Fri, 30 Oct 2026" +
 * "7:00 PM"). Replace with ISO timestamps when the API contract settles.
 */
export function postTimestamp(p: Pick<PostItem, "dateStr" | "time">): number {
  const t = Date.parse(`${p.dateStr.replace(/^\w+,\s*/, "")} ${p.time}`);
  return Number.isNaN(t) ? 0 : t;
}

export function dayAndDate(dateStr: string): { day: string; date: string } {
  const m = dateStr.match(/^(\w+),\s*(\d+)/);
  return { day: m?.[1] ?? "", date: m?.[2] ?? "" };
}
