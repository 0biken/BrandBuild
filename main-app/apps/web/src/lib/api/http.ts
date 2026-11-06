import { API_URL } from "./config";
import type { ApiError, ApiResult } from "./types";

const STATUS_TO_ERROR: Record<number, ApiError> = {
  400: "invalid",
  401: "invalid",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  410: "expired",
  422: "invalid",
};

const TOKEN_KEY = "brandbuild_access_token";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Ignore localStorage access failures
  }
}

/**
 * Fetch against the Rust API. Sends the Bearer token or session cookie and maps HTTP
 * failures onto ApiError, so callers never see raw status codes. Unwraps { data: ... }
 * envelopes returned by the Axum backend when present.
 */
export async function apiFetch<T = void>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<ApiResult<T>> {
  const { body, headers = {}, ...rest } = init;
  const token = getAuthToken();
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  try {
    const res = await fetch(`${API_URL}${path}`, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...authHeaders,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...rest,
    });
    if (!res.ok) {
      return { ok: false, error: STATUS_TO_ERROR[res.status] ?? "network" };
    }
    if (res.status === 204) {
      return { ok: true, data: undefined as T };
    }
    const json = await res.json();
    const data = (json && typeof json === "object" && "data" in json) ? json.data : json;
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "network" };
  }
}
