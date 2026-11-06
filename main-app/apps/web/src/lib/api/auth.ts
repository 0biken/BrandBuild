import { read, write } from "@/lib/mock/store";
import { API_MODE, API_URL } from "./config";
import { apiFetch, setAuthToken } from "./http";
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

/** Where a signed-in user lands. */
export const HOME_HREF = APP_HOME;

const ok: ApiResult = { ok: true, data: undefined };
const wait = (ms = 600) => new Promise<void>((r) => setTimeout(r, ms));

let lastIdentifier = "";

export async function signUp(input: {
  name: string;
  identifier: string;
  password: string;
}): Promise<ApiResult> {
  lastIdentifier = input.identifier;
  if (API_MODE === "http") {
    const res = await apiFetch<{ access_token?: string }>("/auth/signup", {
      method: "POST",
      body: { name: input.name, identifier: input.identifier, password: input.password },
    });
    if (res.ok && res.data?.access_token) {
      setAuthToken(res.data.access_token);
    }
    return res.ok ? ok : res;
  }
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
  lastIdentifier = input.identifier;
  if (API_MODE === "http") {
    const res = await apiFetch<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: { identifier: input.identifier, password: input.password },
    });
    if (res.ok && res.data?.access_token) {
      setAuthToken(res.data.access_token);
      setMockSessionCookie();
    }
    return res.ok ? ok : res;
  }
  await wait();
  const match =
    input.identifier.trim().toLowerCase() === MOCK_ACCOUNT.identifier &&
    input.password === MOCK_ACCOUNT.password;
  if (!match) return { ok: false, error: "invalid" };
  setMockSessionCookie();
  return ok;
}

export async function logOut(): Promise<ApiResult> {
  if (API_MODE === "http") {
    setAuthToken(null);
    clearMockSessionCookie();
    return ok;
  }
  clearMockSessionCookie();
  return ok;
}

export async function getSession(): Promise<ApiResult<Session>> {
  if (API_MODE === "http") return apiFetch<Session>("/v1/tenant/config");
  return read((d) => d.session);
}

export async function signInWithProvider(provider: Provider): Promise<ApiResult> {
  if (API_MODE === "http") {
    // OAuth is a full-page redirect owned by the API.
    // External API origin, not a Next route, so the router can't do this.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`${API_URL}/v1/channels/${provider}/oauth/start`);
    return ok;
  }
  await wait(300);
  return { ok: false, error: "network" };
}

export async function requestCode(identifier: string): Promise<ApiResult> {
  lastIdentifier = identifier;
  if (API_MODE === "http") {
    return apiFetch("/auth/code/request", {
      method: "POST",
      body: { identifier },
    });
  }
  await wait();
  return ok;
}

export async function verifyCode(code: string, identifier?: string): Promise<ApiResult> {
  const id = identifier || lastIdentifier;
  if (API_MODE === "http") {
    const res = await apiFetch<{ reset_token?: string; verified?: boolean }>("/auth/code/verify", {
      method: "POST",
      body: { identifier: id, code },
    });
    if (res.ok && res.data?.reset_token) {
      setAuthToken(res.data.reset_token);
    }
    return res.ok ? ok : res;
  }
  await wait();
  if (code === MOCK_CODE) {
    setMockSessionCookie();
    return ok;
  }
  if (code === MOCK_EXPIRED_CODE) return { ok: false, error: "expired" };
  return { ok: false, error: "invalid" };
}

export async function resetPassword(password: string): Promise<ApiResult> {
  if (API_MODE === "http") {
    const res = await apiFetch<{ access_token?: string }>("/auth/password/reset", {
      method: "POST",
      body: { reset_token: typeof window !== "undefined" ? localStorage.getItem("brandbuild_access_token") ?? "" : "", password },
    });
    if (res.ok && res.data?.access_token) {
      setAuthToken(res.data.access_token);
    }
    return res.ok ? ok : res;
  }
  await wait();
  return ok;
}
