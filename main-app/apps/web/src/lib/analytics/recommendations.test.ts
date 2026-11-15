import { describe, expect, it } from "vitest";
import type { AnalyticsReport, PostFormat, PostPerformance } from "@/lib/api/types";
import { mockAnalytics } from "@/lib/mock/analytics-data";
import { SEED_ACCOUNTS, SEED_PLATFORMS } from "@/lib/mock/seed-data";
import { bestSlots, recommend, slotOf } from "./recommendations";

// Quiet everywhere except Friday and Thursday evenings.
const heatmap = Array.from({ length: 7 }, (_, d) =>
  Array.from({ length: 6 }, (_, s) => (d === 4 && s === 4 ? 1 : d === 3 && s === 4 ? 0.9 : 0.2)),
);

/** Local time, `daysAgo` days back. */
function at(daysAgo: number, hour = 12) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

let n = 0;
function post(p: Partial<PostPerformance> & { format: PostFormat }): PostPerformance {
  n += 1;
  return {
    id: `p${n}`,
    title: `Post ${n}`,
    platforms: ["ig"],
    postedAt: at((n % 25) + 1),
    reach: 1000,
    engagements: 50,
    saves: 5,
    hashtags: 2,
    captionLength: 200,
    ...p,
  };
}

function report(posts: PostPerformance[], over: Partial<AnalyticsReport> = {}): AnalyticsReport {
  const totals = { reach: 0, engagements: posts.reduce((s, p) => s + p.engagements, 0), followers: 0, posts: posts.length };
  return {
    range: "30d",
    from: at(30).slice(0, 10),
    to: at(1).slice(0, 10),
    totals,
    previous: { ...totals },
    daily: [],
    platforms: [],
    heatmap,
    posts,
    accounts: [],
    ...over,
  };
}

describe("recommendations", () => {
  it("finds the busiest heatmap cells", () => {
    expect(bestSlots(heatmap, 2).map((c) => [c.day, c.slot])).toEqual([
      [4, 4],
      [3, 4],
    ]);
    expect(slotOf(at(0, 19)).slot).toBe(4);
  });

  it("suggests the format that outperforms the one used most", () => {
    const posts = [
      ...Array.from({ length: 6 }, () => post({ format: "Photo", engagements: 40 })),
      post({ format: "Reel", engagements: 120 }),
      post({ format: "Reel", engagements: 110 }),
    ];
    const tip = recommend(report(posts), 10).find((t) => t.id === "best-format");
    expect(tip?.title).toBe("Make more reels");
    expect(tip?.why).toMatch(/2 of your 8 posts were reels/);
  });

  it("flags posting at quiet times", () => {
    const posts = Array.from({ length: 5 }, () => post({ format: "Photo" }));
    expect(recommend(report(posts), 10).map((t) => t.id)).toContain("best-time");
  });

  it("asks for more posts when posting is sparse", () => {
    const posts = [2, 12, 25].map((d) => post({ format: "Photo", postedAt: at(d) }));
    const tip = recommend(report(posts), 10).find((t) => t.id === "frequency");
    expect(tip?.title).toBe("Post at least 3 times a week");
    expect(tip?.why).toMatch(/-day gap/);
  });

  it("calls out a drop in engagement", () => {
    const posts = Array.from({ length: 4 }, () => post({ format: "Photo" }));
    const r = report(posts);
    r.previous = { ...r.totals, engagements: r.totals.engagements * 2, posts: 8 };
    const tip = recommend(r, 10).find((t) => t.id === "engagement-drop");
    expect(tip?.title).toBe("Engagement is down 50%");
  });

  it("puts a broken account connection first", () => {
    const posts = Array.from({ length: 5 }, () => post({ format: "Photo" }));
    const tips = recommend(report(posts, { accounts: [{ platform: "tt", handle: "@nova", status: "needs_attention" }] }));
    expect(tips[0]).toMatchObject({ id: "reconnect", title: "Reconnect TikTok" });
  });

  it("explains what's needed when there isn't enough data", () => {
    expect(recommend(report([post({ format: "Photo" })])).map((t) => t.id)).toEqual(["get-started"]);
  });

  it("the demo data gives a full, stable set of tips", () => {
    const a = recommend(mockAnalytics("30d", SEED_PLATFORMS, SEED_ACCOUNTS));
    const b = recommend(mockAnalytics("30d", SEED_PLATFORMS, SEED_ACCOUNTS));
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(a).toEqual(b);
  });
});
