import { beforeEach, describe, expect, it } from "vitest";
import { mockConfig, resetMockDb } from "@/lib/mock/store";
import { listDrafts } from "./drafts";
import { approvePost, listApprovals, rejectPost, requestChanges, undoDecision } from "./approvals";
import { getPost } from "./posts";

beforeEach(() => {
  mockConfig.latencyMs = 0;
  mockConfig.failNext = null;
  resetMockDb();
  sessionStorage.clear();
});

const setRole = (role: "owner" | "editor" | "reviewer") =>
  (window as unknown as { __bbMock: { setRole(r: string): void } }).__bbMock.setRole(role);

async function ids() {
  const res = await listApprovals();
  if (!res.ok) throw new Error("list failed");
  return res.data.map((p) => p.id);
}

describe("approvals API (mock)", () => {
  it("lists waiting posts, soonest to go out first", async () => {
    expect(await ids()).toEqual(["post-3", "post-9", "post-10"]);
  });

  it("approve schedules the post and undo puts it back", async () => {
    const res = await approvePost("post-9");
    if (!res.ok) throw new Error("approve failed");
    expect(res.data.post?.state).toBe("scheduled");
    expect(res.data.post?.time).toBe("6:00 PM");
    expect(await ids()).not.toContain("post-9");

    expect((await undoDecision(res.data)).ok).toBe(true);
    const back = await getPost("post-9");
    expect(back.ok && back.data.state).toBe("approval");
    expect(back.ok && back.data.requestedBy?.name).toBe("Tobi");
  });

  it("approving a post whose time has passed schedules it for a minute from now", async () => {
    const res = await approvePost("post-3");
    if (!res.ok) throw new Error("approve failed");
    expect(res.data.post?.state).toBe("scheduled");
    expect(res.data.post?.dateStr).not.toBe("Thu, 29 Oct 2026");
  });

  it("request changes needs a note and moves the post to Drafts with it", async () => {
    expect(await requestChanges("post-10", "  ")).toEqual({ ok: false, error: "invalid" });

    const res = await requestChanges("post-10", "Use the plum shade photo.");
    if (!res.ok) throw new Error("request failed");
    expect(await ids()).not.toContain("post-10");
    const drafts = await listDrafts();
    const draft = drafts.ok ? drafts.data.find((d) => d.id === res.data.draftId) : undefined;
    expect(draft?.feedback).toBe("Use the plum shade photo.");
    expect(draft?.title).toBe("The two people who pack your order");

    expect((await undoDecision(res.data)).ok).toBe(true);
    expect(await ids()).toContain("post-10");
    const after = await listDrafts();
    expect(after.ok && after.data.some((d) => d.id === res.data.draftId)).toBe(false);
  });

  it("reject moves the post to Drafts", async () => {
    const res = await rejectPost("post-3");
    if (!res.ok) throw new Error("reject failed");
    expect(await getPost("post-3")).toEqual({ ok: false, error: "not_found" });
    expect(res.data.draftId).toBeTruthy();
  });

  it("refuses a second decision on the same post", async () => {
    await approvePost("post-9");
    expect(await rejectPost("post-9")).toEqual({ ok: false, error: "conflict" });
  });

  it("editors can't decide", async () => {
    setRole("editor");
    expect(await approvePost("post-9")).toEqual({ ok: false, error: "forbidden" });
    expect(await ids()).toContain("post-9");
  });

  it("reviewers can decide", async () => {
    setRole("reviewer");
    expect((await approvePost("post-9")).ok).toBe(true);
  });
});
