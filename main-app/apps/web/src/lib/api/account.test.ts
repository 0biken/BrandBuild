import { beforeEach, describe, expect, it } from "vitest";
import { mockConfig, resetMockDb } from "@/lib/mock/store";
import { deleteAccount, getSession, signUp, verifyCode } from "./auth";

beforeEach(() => {
  mockConfig.latencyMs = 0;
  mockConfig.failNext = null;
  resetMockDb();
  sessionStorage.clear();
});

describe("deleteAccount (mock)", () => {
  it("signs out and puts the demo data back to its seed", async () => {
    await signUp({ name: "Ada Obi", identifier: "ada@example.test", password: "Testing123" });
    await verifyCode("123456");
    expect(document.cookie).toContain("bb_session=mock");

    expect(await deleteAccount()).toEqual({ ok: true, data: undefined });

    expect(document.cookie).not.toContain("bb_session=mock");
    const session = await getSession();
    expect(session.ok && session.data.name).not.toBe("Ada Obi");
  });

  it("keeps the account when the call fails, so the user can retry", async () => {
    await verifyCode("123456");
    mockConfig.failNext = "network";

    expect(await deleteAccount()).toEqual({ ok: false, error: "network" });
    expect(document.cookie).toContain("bb_session=mock");
  });
});
