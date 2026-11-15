import { beforeEach, describe, expect, it } from "vitest";
import { mockConfig, resetMockDb } from "@/lib/mock/store";
import { MOCK_EXPIRED_CODE, MOCK_INVALID_CODE, mockCodeResult, verifyCode } from "./auth";
import { sendStudentCode, verifyStudentCode } from "./verify";

beforeEach(() => {
  mockConfig.latencyMs = 0;
  resetMockDb();
  sessionStorage.clear();
});

describe("demo-mode codes", () => {
  it("accepts any 6 digits, so the code page never gets stuck", () => {
    expect(mockCodeResult("482913")).toBe("ok");
    expect(mockCodeResult("123456")).toBe("ok");
  });

  it("keeps the expired and wrong-code states reachable", () => {
    expect(mockCodeResult(MOCK_EXPIRED_CODE)).toBe("expired");
    expect(mockCodeResult(MOCK_INVALID_CODE)).toBe("invalid");
    expect(mockCodeResult("12345")).toBe("invalid");
    expect(mockCodeResult("12a456")).toBe("invalid");
  });

  it("verifyCode signs in with an arbitrary code", async () => {
    expect(await verifyCode("907312")).toEqual({ ok: true, data: undefined });
    expect(document.cookie).toContain("bb_session");
  });

  it("the student code step follows the same rule", async () => {
    await sendStudentCode("ada@stu.ui.edu.ng");
    const res = await verifyStudentCode("555555");
    expect(res.ok && res.data.status).toBe("verified");
  });
});
