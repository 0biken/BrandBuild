import { read } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, ConnectedAccount, PlatformConfig } from "./types";

export async function listAccounts(): Promise<ApiResult<ConnectedAccount[]>> {
  if (API_MODE === "http") return apiFetch<ConnectedAccount[]>("/v1/accounts");
  return read((d) => d.accounts);
}

/** Platforms with per-platform limits and connection hints, for the composer. */
export async function listPlatforms(): Promise<ApiResult<PlatformConfig[]>> {
  if (API_MODE === "http") return apiFetch<PlatformConfig[]>("/v1/platforms");
  return read((d) => d.platforms);
}
