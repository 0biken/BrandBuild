import type { PostItem } from "@/lib/api/types";

/**
 * Helpers for the sample data's display strings ("Fri, 30 Oct 2026" +
 * "7:00 PM"). Replace with ISO timestamps when the API contract settles.
 */
export function postTimestamp(p: Pick<PostItem, "dateStr" | "time">): number {
  const t = Date.parse(`${p.dateStr.replace(/^\w+,\s*/, "")} ${p.time}`);
  return Number.isNaN(t) ? 0 : t;
}

export function postDate(p: Pick<PostItem, "dateStr" | "time">): Date {
  return new Date(postTimestamp(p));
}

export function dayAndDate(dateStr: string): { day: string; date: string } {
  const m = dateStr.match(/^(\w+),\s*(\d+)/);
  return { day: m?.[1] ?? "", date: m?.[2] ?? "" };
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri, 30 Oct 2026" */
export function formatDateStr(d: Date): string {
  return `${DAY[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]} ${d.getFullYear()}`;
}

/** "7:00 PM" */
export function formatTime(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Fri 30 Oct, 7:00 PM" (activity log style) */
export function formatShort(d: Date): string {
  return `${DAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}, ${formatTime(d)}`;
}

/** The display fields a post carries for a given moment. */
export function scheduleFields(d: Date, state: PostItem["state"]): Pick<PostItem, "dateStr" | "time" | "scheduledFor"> {
  const when = `${DAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]} at ${formatTime(d)}`;
  return {
    dateStr: formatDateStr(d),
    time: formatTime(d),
    scheduledFor:
      state === "published"
        ? `Posted ${when}`
        : state === "approval"
          ? `Goes out ${when} once approved`
          : `Posts ${when}`,
  };
}

/** Local YYYY-MM-DD, for date inputs and calendar keys. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local HH:MM, for time inputs. */
export function isoTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Combine a YYYY-MM-DD and an HH:MM (local) into a Date, or null if invalid. */
export function fromInputs(day: string, time: string): Date | null {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = time.match(/^(\d{2}):(\d{2})$/);
  if (!m || !t) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const SHORT_MONTHS = MONTH;

/** True if the moment has passed. Call from event handlers, not render. */
export function isPast(d: Date): boolean {
  return d.getTime() < Date.now();
}
