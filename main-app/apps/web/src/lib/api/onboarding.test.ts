import { beforeEach, describe, expect, it } from "vitest";
import { mockConfig, resetMockDb } from "@/lib/mock/store";
import { finishConnect, listAccounts, startConnect } from "./accounts";
import { signUp } from "./auth";
import { completeStep, getOnboarding, nextStepPath } from "./onboarding";
import { sendStudentCode, skipStudentCheck, studentIdProblem, verifyStudentCode } from "./verify";

beforeEach(() => {
  mockConfig.latencyMs = 0;
  mockConfig.declineFirstConnect = ["fb"];
  resetMockDb();
  sessionStorage.clear();
});

describe("onboarding (mock)", () => {
  it("a new signup starts at the student check and walks the steps in order", async () => {
    await signUp({ name: "Ada", identifier: "ada@example.test", password: "Testing123" });
    let res = await getOnboarding();
    expect(res.ok && nextStepPath(res.data)).toBe("/app/onboarding/verify");
    await completeStep("verify", "skipped");
    res = await getOnboarding();
    expect(res.ok && nextStepPath(res.data)).toBe("/app/onboarding/connect");
    await completeStep("connect", "done");
    await completeStep("brand", "done");
    res = await getOnboarding();
    expect(res.ok && nextStepPath(res.data)).toBeNull();
  });

  it("verifies a school email with the mock code", async () => {
    expect((await sendStudentCode("not-an-email")).ok).toBe(false);
    await sendStudentCode("ada@stu.ui.edu.ng");
    expect(await verifyStudentCode("111111")).toEqual({ ok: false, error: "invalid" });
    const ok = await verifyStudentCode("123456");
    expect(ok.ok && ok.data.status).toBe("verified");
  });

  it("not a student leaves Student Access", async () => {
    const res = await skipStudentCheck();
    expect(res.ok && res.data.status).toBe("not_student");
  });

  it("checks student ID files", () => {
    expect(studentIdProblem({ type: "image/gif", size: 10 })).toMatch(/JPG/);
    expect(studentIdProblem({ type: "image/png", size: 20 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(studentIdProblem({ type: "application/pdf", size: 1000 })).toBeNull();
  });

  it("declines Facebook's first connect, then succeeds on retry", async () => {
    await signUp({ name: "Ada", identifier: "ada@example.test", password: "Testing123" });
    await startConnect("fb");
    expect((await finishConnect("fb")).ok && (await listAccounts()).ok).toBe(true);
    let accounts = await listAccounts();
    expect(accounts.ok && accounts.data.find((a) => a.platform === "fb")?.status).toBe("declined");
    await startConnect("fb");
    await finishConnect("fb");
    accounts = await listAccounts();
    expect(accounts.ok && accounts.data.find((a) => a.platform === "fb")?.status).toBe("connected");
  });
});
