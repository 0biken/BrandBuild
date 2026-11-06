import type {
  AnalyticsRange,
  AnalyticsReport,
  AnalyticsTotals,
  ConnectedAccount,
  PlatformConfig,
  PlatformId,
  PostFormat,
  PostPerformance,
} from "@/lib/api/types";

/**
 * Demo analytics for the mock back end. Everything comes from a seeded
 * random generator, so the numbers are the same on every load, but dates
 * are relative to today so the screen always looks current.
 *
 * The history is shaped so each recommendation rule has something to say:
 * Reels outperform photos but are posted less, most posts go out at noon
 * while followers are busiest on Thursday and Friday evenings, and posting
 * slowed down over the last month.
 */

const DAY = 86_400_000;
export const RANGE_DAYS: Record<AnalyticsRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLES = [
  "Packing, start to finish",
  "Your reviews, read aloud",
  "Shade swatches",
  "Founder note: year one",
  "Behind the counter",
  "Gloss close-ups",
  "How we test every batch",
  "Three looks, one gloss",
  "Restock alert",
  "Meet the team",
  "Lip care routine",
  "Gift wrapping for the holidays",
  "Customer shout-out",
  "Weekend drop prep",
  "What's in the box",
  "From sketch to shelf",
];

/** Followers' activity by weekday (Mon first) and 3-hour slot from 6 AM. */
const ACTIVITY: number[][] = [
  [0.15, 0.3, 0.45, 0.35, 0.55, 0.35],
  [0.15, 0.3, 0.4, 0.35, 0.6, 0.4],
  [0.2, 0.35, 0.45, 0.4, 0.65, 0.4],
  [0.2, 0.35, 0.5, 0.45, 0.95, 0.55],
  [0.2, 0.35, 0.5, 0.5, 1, 0.65],
  [0.25, 0.6, 0.55, 0.45, 0.7, 0.5],
  [0.2, 0.5, 0.5, 0.4, 0.6, 0.35],
];

const FORMAT_LIFT: Record<PostFormat, number> = { Reel: 2.3, Carousel: 1.5, Video: 1.2, Photo: 1 };
const FORMAT_SAVES: Record<PostFormat, number> = { Reel: 0.09, Carousel: 0.2, Video: 0.08, Photo: 0.07 };

interface HistoryPost extends PostPerformance {
  /** Days before today. */
  ago: number;
}

/** About 180 days of posts, newest first. */
function history(): HistoryPost[] {
  const r = rng(26);
  const posts: HistoryPost[] = [];
  let ago = 2;
  let n = 0;
  while (ago < 180) {
    const recent = ago < 35;
    const roll = r();
    // Mostly photos, fewer Reels, even though Reels do best.
    const format: PostFormat = roll < 0.18 ? "Reel" : roll < 0.4 ? "Carousel" : roll < 0.5 ? "Video" : "Photo";
    const weekday = Math.floor(r() * 7);
    // Most posts go out around noon; a few in the evening.
    const slot = r() < 0.75 ? 2 : r() < 0.5 ? 4 : 1;
    const activity = ACTIVITY[weekday][slot];
    const hashtags = Math.floor(r() * 9);
    const tagLift = hashtags >= 3 && hashtags <= 5 ? 1.25 : hashtags > 6 ? 0.85 : 1;
    const base = (recent ? 1700 : 2100) * (0.75 + r() * 0.5);
    const reach = Math.round(base * FORMAT_LIFT[format] ** 0.6 * (0.6 + activity) * tagLift);
    const rate = 0.045 * FORMAT_LIFT[format] ** 0.5 * (0.7 + activity * 0.6) * tagLift * (0.8 + r() * 0.4);
    const engagements = Math.round(reach * rate);
    const day = new Date(Date.now() - ago * DAY);
    // Step back to the chosen weekday (0 = Monday), then set the time.
    const offset = ((day.getDay() + 6) % 7 - weekday + 7) % 7;
    const at = new Date(day.getTime() - offset * DAY);
    at.setHours(6 + slot * 3 + Math.floor(r() * 3), [0, 15, 30][Math.floor(r() * 3)], 0, 0);
    const actualAgo = Math.round((Date.now() - at.getTime()) / DAY);
    if (actualAgo >= 1) {
      posts.push({
        id: `perf-${++n}`,
        title: TITLES[n % TITLES.length],
        format,
        platforms: (r() < 0.6 ? ["ig", "li"] : r() < 0.5 ? ["ig", "tt"] : ["ig"]) as PlatformId[],
        postedAt: at.toISOString(),
        reach,
        engagements,
        saves: Math.round(engagements * FORMAT_SAVES[format] * 3),
        hashtags,
        captionLength: Math.round(80 + r() * 520),
        ago: actualAgo,
      });
    }
    // Posting slowed down lately: every 3-5 days now, every 2-3 before.
    ago += recent ? 3 + Math.floor(r() * 3) : 2 + Math.floor(r() * 2);
  }
  return posts.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

function totals(posts: HistoryPost[]): AnalyticsTotals {
  const reach = posts.reduce((s, p) => s + p.reach, 0);
  const engagements = posts.reduce((s, p) => s + p.engagements, 0);
  return { reach, engagements, followers: Math.round(engagements * 0.012), posts: posts.length };
}

/** Each post keeps earning for a few days after it goes out. */
function dailySeries(posts: HistoryPost[], from: number, days: number): number[] {
  const out = Array.from({ length: days }, (_, i) => 18 + ((i * 37) % 23));
  for (const p of posts) {
    const share = [0.55, 0.25, 0.12, 0.08];
    share.forEach((f, k) => {
      const idx = from - p.ago + k;
      if (idx >= 0 && idx < days) out[idx] += Math.round(p.engagements * f);
    });
  }
  return out;
}

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function strip(p: HistoryPost): PostPerformance {
  const { id, title, format, platforms, postedAt, reach, engagements, saves, hashtags, captionLength } = p;
  return { id, title, format, platforms, postedAt, reach, engagements, saves, hashtags, captionLength };
}

export function mockAnalytics(
  range: AnalyticsRange,
  platforms: PlatformConfig[],
  accounts: ConnectedAccount[],
): AnalyticsReport {
  const days = RANGE_DAYS[range];
  const all = history();
  const current = all.filter((p) => p.ago >= 1 && p.ago <= days);
  const prior = all.filter((p) => p.ago > days && p.ago <= days * 2);

  // Index 0 is the oldest day; a post `ago` days back lands at days - ago.
  const now = dailySeries(current, days, days);
  const before = dailySeries(prior.map((p) => ({ ...p, ago: p.ago - days })), days, days);
  const daily = now.map((v, i) => ({
    date: isoDay(new Date(Date.now() - (days - i) * DAY)),
    engagements: v,
    previous: before[i],
  }));

  const byPlatform = new Map<PlatformId, number>();
  for (const p of current) {
    for (const id of p.platforms) {
      const weight = id === "ig" ? 0.62 : id === "tt" ? 0.28 : 0.1;
      byPlatform.set(id, (byPlatform.get(id) ?? 0) + Math.round(p.engagements * weight));
    }
  }

  return {
    range,
    from: daily[0].date,
    to: daily[daily.length - 1].date,
    totals: totals(current),
    previous: totals(prior),
    daily,
    platforms: platforms
      .filter((pf) => byPlatform.has(pf.id))
      .map((pf) => ({ id: pf.id, name: pf.name, k: pf.k, bg: pf.bg, engagements: byPlatform.get(pf.id)! }))
      .sort((a, b) => b.engagements - a.engagements),
    heatmap: ACTIVITY.map((row) => [...row]),
    posts: current.map(strip),
    accounts: accounts.map((a) => ({ platform: a.platform, handle: a.handle, status: a.status })),
  };
}
