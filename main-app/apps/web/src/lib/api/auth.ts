import { API_MODE, API_URL } from "./config";
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
 *  - verifyCode: MOCK_CODE succeeds, MOCK_EXPIRED_CODE is "expired",
 *                any other 6 digits is "invalid".
 *  - signInWithProvider: always "network" (not wired up yet).
 *  - signUp / requestCode / resetPassword: always succeed.
 */

export type { Provider };

export const MOCK_ACCOUNT = {
  identifier: "mary@novastudio.co",
  password: "Glossdrop26",
} as const;
export const MOCK_CODE = "123456";
export const MOCK_EXPIRED_CODE = "000000";

const MOCK_SESSION: Session = {
  userId: "user-mary",
  name: "Mary",
  identifier: MOCK_ACCOUNT.identifier,
  role: "owner",
};

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
  await wait();
  return ok;
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

export async function getSession(): Promise<ApiResult<Session>> {
  if (API_MODE === "http") return apiFetch<Session>("/v1/auth/session");
  await wait(150);
  return { ok: true, data: MOCK_SESSION };
}

export async function signInWithProvider(provider: Provider): Promise<ApiResult> {
  if (API_MODE === "http") {
    // OAuth is a full-page redirect owned by the API.
    // External API origin, not a Next route, so the router can't do this.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`${API_URL}/v1/auth/oauth/${provider}`);
    return ok;
  }
  await wait(300);
  return { ok: false, error: "network" };
}

export async function requestCode(identifier: string): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/auth/code", { method: "POST", body: { identifier } });
  await wait();
  return ok;
}

export async function verifyCode(code: string): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/auth/code/verify", { method: "POST", body: { code } });
  await wait();
  if (code === MOCK_CODE) {
    setMockSessionCookie();
    return ok;
  }
  if (code === MOCK_EXPIRED_CODE) return { ok: false, error: "expired" };
  return { ok: false, error: "invalid" };
}

export async function resetPassword(password: string): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/auth/password", { method: "POST", body: { password } });
  await wait();
  return ok;
}
