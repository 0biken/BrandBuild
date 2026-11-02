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
    if (!res.ok) {
      return { ok: false, error: STATUS_TO_ERROR[res.status] ?? "network" };
    }
    const data = res.status === 204 ? undefined : await res.json();
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "network" };
  }
}
