import { read } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, StatItem } from "./types";

export async function getHomeStats(): Promise<ApiResult<StatItem[]>> {
  if (API_MODE === "http") return apiFetch<StatItem[]>("/v1/analytics/home");
  return read((d) => d.stats);
}
