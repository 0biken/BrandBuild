import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockConfig, resetMockDb } from "@/lib/mock/store";
import { listDrafts } from "./drafts";
import { cancelRun, createPlan, getRun, isActive } from "./plans";

beforeEach(() => {
  mockConfig.latencyMs = 0;
  mockConfig.failNext = null;
  resetMockDb();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

const goal = { goal: "Sell out the new shades", weeks: 2 as const, platforms: ["ig" as const], startDate: "2026-11-16" };

describe("plans API (mock)", () => {
  it("runs, then saves AI drafts in their slots with a held-back summary", async () => {
    const before = await listDrafts();
    if (!before.ok) throw new Error("list failed");
    const start = await createPlan(goal);
    if (!start.ok) throw new Error("start failed");

    const working = await getRun(start.data.runId);
    expect(working.ok && isActive(working.data)).toBe(true);

    vi.advanceTimersByTime(5000);
    const done = await getRun(start.data.runId);
    if (!done.ok) throw new Error("run failed");
    expect(done.data.status).toBe("awaiting_review");
    expect(done.data.draftIds).toHaveLength(6);
    expect(done.data.dropped[0].reason).toContain("verified fact");

    const after = await listDrafts();
    if (!after.ok) throw new Error("list failed");
    const ai = after.data.filter((d) => d.source?.kind === "ai_plan");
    expect(ai).toHaveLength(6);
    expect(ai.every((d) => d.scheduledAt)).toBe(true);
    expect(after.data).toHaveLength(before.data.length + 6);

    // Finished runs can't be canceled.
    const late = await cancelRun(start.data.runId);
    expect(late).toEqual({ ok: false, error: "conflict" });
  });

  it("a canceled plan saves nothing", async () => {
    const start = await createPlan(goal);
    if (!start.ok) throw new Error("start failed");
    const canceled = await cancelRun(start.data.runId);
    expect(canceled.ok && canceled.data.status).toBe("canceled");
    vi.advanceTimersByTime(5000);
    const drafts = await listDrafts();
    expect(drafts.ok && drafts.data.some((d) => d.source)).toBe(false);
  });

  it("refuses an empty goal", async () => {
    expect(await createPlan({ ...goal, goal: " " })).toEqual({ ok: false, error: "invalid" });
  });
});
