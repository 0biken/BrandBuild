import { read, write } from "@/lib/mock/store";
import { mockCodeResult } from "./auth";
import { API_MODE } from "./config";
import { apiFetch, apiUpload } from "./http";
import type { ApiResult, StudentCheck } from "./types";

/**
 * Student check (Verify screen). Mock behaviour mirrors auth codes:
 * any 6 digits verify, except MOCK_EXPIRED_CODE and MOCK_INVALID_CODE.
 * Only school addresses qualify, by the same rule as the API (backend/src/onboarding.rs).
 */

/** `.edu`, `.edu.<country>` or `.ac.<country>`. STUDENT_EMAIL_DOMAINS on the API adds more. */
export function isAcademicEmail(email: string): boolean {
  const match = /^[^\s@]+@([^\s@]+)$/.exec(email.trim().toLowerCase());
  if (!match) return false;
  const labels = match[1].split(".");
  if (labels.length < 2 || labels.some((l) => l === "")) return false;
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  return last === "edu" || (labels.length >= 3 && (second === "edu" || second === "ac") && /^[a-z]{2}$/.test(last));
}

/** Student ID review isn't built yet; the Verify screen shows it as "Coming soon". */
export const STUDENT_ID_AVAILABLE = false;

const ID_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const ID_MAX_BYTES = 10 * 1024 * 1024;

export async function getStudentCheck(): Promise<ApiResult<StudentCheck>> {
  if (API_MODE === "http") return apiFetch<StudentCheck>("/v1/student-check");
  return read((d) => d.studentCheck);
}

export async function sendStudentCode(email: string): Promise<ApiResult<StudentCheck>> {
  if (API_MODE === "http") return apiFetch<StudentCheck>("/v1/student-check/code", { method: "POST", body: { email } });
  if (!isAcademicEmail(email)) return { ok: false, error: "invalid" };
  return write((d) => {
    d.studentCheck = { status: "code_sent", method: "email", email: email.trim() };
    return d.studentCheck;
  });
}

export async function verifyStudentCode(code: string): Promise<ApiResult<StudentCheck>> {
  if (API_MODE === "http") {
    return apiFetch<StudentCheck>("/v1/student-check/code/verify", { method: "POST", body: { code } });
  }
  return write((d) => {
    if (d.studentCheck.status !== "code_sent") return "conflict";
    const result = mockCodeResult(code);
    if (result !== "ok") return result;
    d.studentCheck = { ...d.studentCheck, status: "verified" };
    d.brand.plan = "student";
    return d.studentCheck;
  });
}

/** Checks the file before upload; returns a message for the user, or null. */
export function studentIdProblem(file: Pick<File, "type" | "size">): string | null {
  if (!ID_TYPES.includes(file.type)) return "Use a JPG, PNG or PDF.";
  if (file.size > ID_MAX_BYTES) return "That file is over 10 MB. Try a smaller photo.";
  return null;
}

export async function submitStudentId(file: File): Promise<ApiResult<StudentCheck>> {
  if (studentIdProblem(file)) return { ok: false, error: "invalid" };
  if (API_MODE === "http") {
    return apiUpload<StudentCheck>("/v1/student-check/id", file);
  }
  // Matches the API, which answers 501 not_available until review exists.
  if (!STUDENT_ID_AVAILABLE) return { ok: false, error: "network" };
  return write((d) => {
    d.studentCheck = { status: "pending_review", method: "id" };
    return d.studentCheck;
  });
}

/** "I'm not a student": no Student Access, continue setup. */
export async function skipStudentCheck(): Promise<ApiResult<StudentCheck>> {
  if (API_MODE === "http") return apiFetch<StudentCheck>("/v1/student-check/skip", { method: "POST" });
  return write((d) => {
    d.studentCheck = { status: "not_student" };
    d.brand.plan = "creator";
    return d.studentCheck;
  });
}
