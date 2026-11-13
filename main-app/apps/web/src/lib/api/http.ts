import { API_URL } from "./config";
import type { ApiError, ApiResult } from "./types";

const STATUS_TO_ERROR: Record<number, ApiError> = {
  400: "invalid",
  401: "invalid",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  410: "expired",
  415: "invalid",
  422: "invalid",
};

const CODE_TO_ERROR: Record<string, ApiError> = {
  invalid_request: "invalid",
  invalid_input: "invalid",
  invalid_credentials: "invalid",
  invalid_code: "invalid",
  unauthorized: "invalid",
  code_expired: "expired",
  forbidden: "forbidden",
  email_not_verified: "forbidden",
  not_found: "not_found",
  account_exists: "conflict",
  conflict: "conflict",
  auth_not_configured: "network",
  email_unavailable: "network",
  not_available: "network",
  rate_limited: "network",
  internal_error: "network",
};

/** Turn a response into an ApiResult, per docs/api/openapi.yaml. */
async function toResult<T>(res: Response): Promise<ApiResult<T>> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    const code = body?.error?.code;
    const error = (code && CODE_TO_ERROR[code]) || STATUS_TO_ERROR[res.status] || "network";
    return { ok: false, error };
  }
  if (res.status === 204) return { ok: true, data: undefined as T };
  const body = (await res.json()) as { data: T };
  return { ok: true, data: body.data };
}

/**
 * Fetch against the Rust API. Sends the session cookie and maps HTTP
 * failures onto ApiError, so callers never see raw status codes.
 */
export async function apiFetch<T = void>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<ApiResult<T>> {
  const { body, headers, ...rest } = init;
  try {
    const res = await fetch(`${API_URL}${path}`, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...rest,
    });
    return await toResult<T>(res);
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Multipart file upload, with the same result handling as apiFetch. */
export async function apiUpload<T>(path: string, file: File): Promise<ApiResult<T>> {
  const body = new FormData();
  body.append("file", file);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      body,
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    return await toResult<T>(res);
  } catch {
    return { ok: false, error: "network" };
  }
}
