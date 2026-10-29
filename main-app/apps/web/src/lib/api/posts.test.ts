import { beforeEach, describe, expect, it } from "vitest";
import { mockConfig, resetMockDb } from "@/lib/mock/store";
import { createPost, getPost, listPosts, setPostState } from "./posts";

beforeEach(() => {
  mockConfig.latencyMs = 0;
  mockConfig.failNext = null;
  resetMockDb();
  sessionStorage.clear();
});

describe("posts API (mock)", () => {
  it("lists the seeded posts", async () => {
    const res = await listPosts();
    expect(res.ok && res.data.length).toBeGreaterThan(0);
  });

  it("returns not_found for an unknown id", async () => {
    expect(await getPost("nope")).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses to reschedule a post whose outcome is still being checked", async () => {
    const created = await createPost({
      ...(await firstPost()),
      state: "checking",
    });
    if (!created.ok) throw new Error("create failed");
    expect(await setPostState(created.data.id, "scheduled")).toEqual({
      ok: false,
      error: "conflict",
    });
  });

  it("saves writes to sessionStorage so they survive a reload", async () => {
    const created = await createPost({ ...(await firstPost()), title: "Kept" });
    if (!created.ok) throw new Error("create failed");
    const saved = JSON.parse(sessionStorage.getItem("bb:mock-db:v1") ?? "{}");
    expect(saved.posts[0].title).toBe("Kept");
  });

  it("does not save a rejected write", async () => {
    await setPostState("nope", "paused");
    expect(sessionStorage.getItem("bb:mock-db:v1")).toBeNull();
  });

  it("fails once when failNext is set, then recovers", async () => {
    mockConfig.failNext = "network";
    expect(await listPosts()).toEqual({ ok: false, error: "network" });
    expect((await listPosts()).ok).toBe(true);
  });
});

async function firstPost() {
  const res = await listPosts();
  if (!res.ok) throw new Error("list failed");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, activityLog, ...rest } = res.data[0];
  return rest;
}
