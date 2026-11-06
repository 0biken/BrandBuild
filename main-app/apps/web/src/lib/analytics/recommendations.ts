import type { AnalyticsReport, PostFormat, PostPerformance } from "@/lib/api/types";
import { ROUTES } from "@/lib/routes";

/**
 * Growth recommendations, worked out from an analytics report with plain
 * rules (no AI yet). Each rule looks at one habit, compares it with what
 * performs best for this account, and suggests one action. Rules that have
 * nothing useful to say return null. Results are ranked by estimated impact.
 */

export interface Recommendation {
  id: string;
  title: string;
  /** The evidence, in plain words with the account's own numbers. */
  why: string;
  action: { label: string; href: string };
  /** Rough 0-100 estimate used for ranking. */
  impact: number;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const SLOTS = ["6-9 AM", "9 AM-12 PM", "12-3 PM", "3-6 PM", "6-9 PM", "9 PM-12 AM"];
const PLATFORM_NAMES: Record<string, string> = { ig: "Instagram", li: "LinkedIn", tt: "TikTok", fb: "Facebook", yt: "YouTube" };

const MIN_POSTS = 3;
const rate = (p: PostPerformance) => (p.reach ? p.engagements / p.reach : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const times = (x: number) => `${x >= 10 ? Math.round(x) : Math.round(x * 10) / 10}×`;
const compose = (idea?: string) => (idea ? `${ROUTES.compose}?idea=${encodeURIComponent(idea)}` : ROUTES.compose);

/** Weekday (0 = Monday) and 3-hour slot (0 = 6 AM) a post went out in. */
export function slotOf(iso: string): { day: number; slot: number } {
  const d = new Date(iso);
  return { day: (d.getDay() + 6) % 7, slot: Math.min(5, Math.max(0, Math.floor((d.getHours() - 6) / 3))) };
}

/** The busiest cells in the heatmap, best first. */
export function bestSlots(heatmap: number[][], n = 2): { day: number; slot: number; score: number }[] {
  return heatmap
    .flatMap((row, day) => row.map((score, slot) => ({ day, slot, score })))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function bestTime(r: AnalyticsReport): Recommendation | null {
  if (r.posts.length < MIN_POSTS) return null;
  const top = bestSlots(r.heatmap, 2);
  const inTop = r.posts.filter((p) => {
    const s = slotOf(p.postedAt);
    return top.some((t) => t.day === s.day && t.slot === s.slot);
  }).length;
  const share = inTop / r.posts.length;
  if (share >= 0.5) return null;
  const days = [...new Set(top.map((t) => WEEKDAYS[t.day]))].join(" and ");
  const slots = [...new Set(top.map((t) => SLOTS[t.slot]))].join(" or ");
  return {
    id: "best-time",
    title: `Post on ${days}, ${slots}`,
    why: `Your followers are most active then, but only ${inTop} of your ${r.posts.length} posts went out at those times.`,
    action: { label: "Schedule a post", href: ROUTES.compose },
    impact: Math.round(40 + (1 - share) * 40),
  };
}

function bestFormat(r: AnalyticsReport): Recommendation | null {
  const by = new Map<PostFormat, PostPerformance[]>();
  r.posts.forEach((p) => by.set(p.format, [...(by.get(p.format) ?? []), p]));
  const stats = [...by.entries()]
    .filter(([, ps]) => ps.length >= 2)
    .map(([format, ps]) => ({ format, count: ps.length, eng: avg(ps.map((p) => p.engagements)) }));
  if (stats.length < 2) return null;
  const best = stats.reduce((a, b) => (b.eng > a.eng ? b : a));
  const most = stats.reduce((a, b) => (b.count > a.count ? b : a));
  if (best.format === most.format) return null;
  const lift = best.eng / most.eng;
  if (lift < 1.3) return null;
  const plural = (f: PostFormat) => (f === "Carousel" ? "carousels" : `${f.toLowerCase()}s`);
  return {
    id: "best-format",
    title: `Make more ${plural(best.format)}`,
    why: `Your ${plural(best.format)} get ${times(lift)} the engagement of ${plural(most.format)}, but only ${best.count} of your ${r.posts.length} posts were ${plural(best.format)}.`,
    action: { label: `Write a ${best.format.toLowerCase()}`, href: compose(`A ${best.format.toLowerCase()} about `) },
    impact: Math.round(Math.min(90, 35 + lift * 18)),
  };
}

function frequency(r: AnalyticsReport): Recommendation | null {
  if (r.posts.length < MIN_POSTS) return null;
  const days = Math.max(1, (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1);
  const perWeek = (r.posts.length / days) * 7;
  const dates = r.posts.map((p) => Date.parse(p.postedAt)).sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < dates.length; i++) gap = Math.max(gap, (dates[i] - dates[i - 1]) / 86_400_000);
  const longGap = Math.round(gap) > 5;
  if (perWeek >= 3 && !longGap) return null;
  const rounded = Math.round(perWeek * 10) / 10;
  return {
    id: "frequency",
    title: perWeek < 3 ? "Post at least 3 times a week" : "Keep a steady rhythm",
    why:
      `You're posting about ${rounded} time${rounded === 1 ? "" : "s"} a week` +
      (longGap ? `, with a ${Math.round(gap)}-day gap at one point` : "") +
      ". Accounts that post 3 to 5 times a week, every week, grow faster.",
    action: { label: "Plan your week", href: ROUTES.calendar },
    impact: perWeek < 3 ? Math.round(50 + (3 - Math.min(3, perWeek)) * 12) : 40,
  };
}

function engagementTrend(r: AnalyticsReport): Recommendation | null {
  if (!r.previous.engagements || r.totals.posts === 0) return null;
  const change = (r.totals.engagements - r.previous.engagements) / r.previous.engagements;
  if (change > -0.1) return null;
  const fewer = r.totals.posts < r.previous.posts;
  return {
    id: "engagement-drop",
    title: `Engagement is down ${pct(-change)}`,
    why: fewer
      ? `You posted ${r.totals.posts} times this period against ${r.previous.posts} before. Fewer posts is the main reason.`
      : `You posted as often as before, so try reusing what worked: your top post is a good place to start.`,
    action: { label: fewer ? "Schedule more posts" : "See top posts", href: fewer ? ROUTES.calendar : "#top-posts" },
    impact: Math.round(Math.min(85, 45 + -change * 100)),
  };
}

function topPost(r: AnalyticsReport): Recommendation | null {
  if (r.posts.length < MIN_POSTS) return null;
  const best = r.posts.reduce((a, b) => (rate(b) > rate(a) ? b : a));
  const mean = avg(r.posts.map(rate));
  if (!mean || rate(best) < mean * 1.3) return null;
  return {
    id: "top-post",
    title: `Make more like "${best.title}"`,
    why: `It got ${times(rate(best) / mean)} your average engagement rate and ${best.saves.toLocaleString()} saves. A follow-up on the same idea usually does well too.`,
    action: { label: "Write a follow-up", href: compose(`Follow-up to "${best.title}"`) },
    impact: 55,
  };
}

function hashtags(r: AnalyticsReport): Recommendation | null {
  const sweet = r.posts.filter((p) => p.hashtags >= 3 && p.hashtags <= 5);
  const rest = r.posts.filter((p) => p.hashtags < 3 || p.hashtags > 5);
  if (sweet.length < 2 || rest.length < 2) return null;
  const lift = avg(sweet.map(rate)) / avg(rest.map(rate));
  if (lift < 1.1) return null;
  return {
    id: "hashtags",
    title: "Use 3 to 5 hashtags",
    why: `Posts with 3 to 5 hashtags got ${pct(lift - 1)} more engagement than posts with fewer or more. ${rest.length} of your posts were outside that range.`,
    action: { label: "Write a post", href: ROUTES.compose },
    impact: Math.round(25 + (lift - 1) * 60),
  };
}

function accounts(r: AnalyticsReport): Recommendation | null {
  const broken = r.accounts.filter((a) => a.status === "needs_attention");
  if (!broken.length) return null;
  const names = broken.map((a) => PLATFORM_NAMES[a.platform] ?? a.platform).join(" and ");
  return {
    id: "reconnect",
    title: `Reconnect ${names}`,
    why: `Posts to ${names} are on hold until you sign in again, so those followers aren't seeing anything new.`,
    action: { label: "Reconnect", href: ROUTES.connect },
    impact: 95,
  };
}

function getStarted(r: AnalyticsReport): Recommendation | null {
  if (r.posts.length >= MIN_POSTS) return null;
  return {
    id: "get-started",
    title: "Post a few times to unlock tips",
    why: `We need at least ${MIN_POSTS} posts in this period to spot what works for you. You have ${r.posts.length}.`,
    action: { label: "Write a post", href: ROUTES.compose },
    impact: 60,
  };
}

const RULES = [accounts, engagementTrend, frequency, bestFormat, bestTime, topPost, hashtags, getStarted];

export function recommend(report: AnalyticsReport, limit = 5): Recommendation[] {
  return RULES.map((rule) => rule(report))
    .filter((x): x is Recommendation => x !== null)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, limit);
}
