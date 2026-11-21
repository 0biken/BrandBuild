import { beforeEach, describe, expect, it } from "vitest";
import { mockConfig, resetMockDb } from "@/lib/mock/store";
import { finishConnect, listAccounts, startConnect } from "./accounts";
import { signUp } from "./auth";
import { completeStep, getOnboarding, nextStepPath } from "./onboarding";
import {
  isAcademicEmail,
  sendStudentCode,
  skipStudentCheck,
  studentIdProblem,
  submitStudentId,
  verifyStudentCode,
} from "./verify";

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
    expect(await sendStudentCode("ada@gmail.com")).toEqual({ ok: false, error: "invalid" });
    await sendStudentCode("ada@stu.ui.edu.ng");
    expect(await verifyStudentCode("111111")).toEqual({ ok: false, error: "invalid" });
    const ok = await verifyStudentCode("123456");
    expect(ok.ok && ok.data.status).toBe("verified");
  });

  it("not a student leaves Student Access", async () => {
    const res = await skipStudentCheck();
    expect(res.ok && res.data.status).toBe("not_student");
  });

  it("counts the same school addresses as the API", () => {
    for (const ok of ["ada@stu.ui.edu.ng", "ada@ox.ac.uk", "ada@mit.edu", "Ada@Student.Unilag.EDU.NG"]) {
      expect(isAcademicEmail(ok)).toBe(true);
    }
    for (const no of ["ada@gmail.com", "ada@edu.com", "ada@ac.com", "not-an-email", "ada@.edu"]) {
      expect(isAcademicEmail(no)).toBe(false);
    }
  });

  it("student ID upload isn't available yet", async () => {
    const file = new File(["x"], "id.png", { type: "image/png" });
    expect(await submitStudentId(file)).toEqual({ ok: false, error: "network" });
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
