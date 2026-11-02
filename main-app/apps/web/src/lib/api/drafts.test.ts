import { beforeEach, describe, expect, it } from "vitest";
import { mockConfig, resetMockDb } from "@/lib/mock/store";
import { deleteDraft, listDrafts, restoreDraft } from "./drafts";

beforeEach(() => {
  mockConfig.latencyMs = 0;
  resetMockDb();
  sessionStorage.clear();
});

describe("drafts API (mock)", () => {
  it("restores a deleted draft with the same id, in the same position", async () => {
    const before = await listDrafts();
    if (!before.ok) throw new Error("list failed");
    const target = before.data[2];

    const del = await deleteDraft(target.id);
    if (!del.ok) throw new Error("delete failed");
    expect(del.data.index).toBe(2);

    await restoreDraft(target, del.data.index);
    const after = await listDrafts();
    expect(after.ok && after.data.map((d) => d.id)).toEqual(before.data.map((d) => d.id));
  });

  it("refuses to restore a draft that already exists", async () => {
    const res = await listDrafts();
    if (!res.ok) throw new Error("list failed");
    expect(await restoreDraft(res.data[0], 0)).toEqual({ ok: false, error: "conflict" });
  });
});
