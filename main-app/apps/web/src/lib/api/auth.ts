import { read, resetMockDb, write } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import {
  APP_HOME,
  clearMockSessionCookie,
  setMockSessionCookie,
} from "./session";
import type { ApiResult, Provider, Session } from "./types";

/**
 * Auth API. In mock mode every call resolves after a short delay, with
 * behaviour chosen so each designed state is reachable:
 *  - logIn:      succeeds only for MOCK_ACCOUNT; anything else is "invalid".
 *  - verifyCode: no email is sent in demo mode, so any 6 digits succeed,
 *                except MOCK_EXPIRED_CODE ("expired") and MOCK_INVALID_CODE
 *                ("invalid"), which keep those designed states reachable.
 *  - signInWithProvider: always "network" in both modes (deferred).
 *  - signUp / requestCode / resetPassword: always succeed.
 */

export type { Provider };

export const MOCK_ACCOUNT = {
  identifier: "mary@novastudio.co",
  password: "Glossdrop26",
} as const;
export const MOCK_CODE = "123456";
export const MOCK_EXPIRED_CODE = "000000";
export const MOCK_INVALID_CODE = "111111";

/** True when no real codes are sent, so the UI should say so. */
export const DEMO_CODES = API_MODE !== "http";

/** Demo-mode rule shared by every code screen. */
export function mockCodeResult(code: string): "ok" | "expired" | "invalid" {
  if (!/^\d{6}$/.test(code)) return "invalid";
  if (code === MOCK_EXPIRED_CODE) return "expired";
  if (code === MOCK_INVALID_CODE) return "invalid";
  return "ok";
}

/** Where a signed-in user lands. */
export const HOME_HREF = APP_HOME;

const ok: ApiResult = { ok: true, data: undefined };
const wait = (ms = 600) => new Promise<void>((r) => setTimeout(r, ms));

export async function signUp(input: {
  name: string;
  identifier: string;
  password: string;
}): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/auth/signup", { method: "POST", body: input });
  // A new account starts onboarding from scratch.
  return write((d) => {
    d.onboarding = { verify: "todo", connect: "todo", brand: "todo" };
    d.studentCheck = { status: "none" };
    d.accounts = [];
    d.connectAttempts = {};
    d.session = { ...d.session, name: input.name, identifier: input.identifier, role: "owner" };
    return undefined;
  });
}

export async function logIn(input: {
  identifier: string;
  password: string;
}): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/auth/login", { method: "POST", body: input });
  await wait();
  const match =
    input.identifier.trim().toLowerCase() === MOCK_ACCOUNT.identifier &&
    input.password === MOCK_ACCOUNT.password;
  if (!match) return { ok: false, error: "invalid" };
  setMockSessionCookie();
  return ok;
}

export async function logOut(): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/auth/logout", { method: "POST" });
  clearMockSessionCookie();
  return ok;
}

/**
 * Permanently delete the signed-in user's account and sign them out. In mock
 * mode the demo data goes back to its seed, so the demo account still works.
 */
export async function deleteAccount(): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/auth/account", { method: "DELETE" });
  const res = await write(() => undefined);
  if (!res.ok) return res;
  resetMockDb();
  clearMockSessionCookie();
  return ok;
}

export async function getSession(): Promise<ApiResult<Session>> {
  if (API_MODE === "http") return apiFetch<Session>("/v1/auth/session");
  return read((d) => d.session);
}

/**
 * Google and Apple sign-in are deferred (x-status: deferred in the contract), so
 * this never calls the API. When they ship, http mode becomes a full-page redirect
 * to `{API_URL}/v1/auth/oauth/{provider}`.
 */
export async function signInWithProvider(provider: Provider): Promise<ApiResult> {
  void provider;
  await wait(300);
  return { ok: false, error: "network" };
}

export async function requestCode(identifier: string): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/auth/code", { method: "POST", body: { identifier } });
  await wait();
  return ok;
}

export async function verifyCode(code: string, identifier = ""): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/auth/code/verify", { method: "POST", body: { identifier, code } });
  await wait();
  const result = mockCodeResult(code);
  if (result !== "ok") return { ok: false, error: result };
  setMockSessionCookie();
  return ok;
}

export async function resetPassword(password: string): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/auth/password", { method: "POST", body: { password } });
  await wait();
  return ok;
}
