import { mockAnalytics } from "@/lib/mock/analytics-data";
import { read } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { AnalyticsRange, AnalyticsReport, ApiResult, StatItem } from "./types";

export async function getHomeStats(): Promise<ApiResult<StatItem[]>> {
  if (API_MODE === "http") return apiFetch<StatItem[]>("/v1/analytics/home");
  return read((d) => d.stats);
}

/** Results for the Analytics screen over the last 7, 30 or 90 days. */
export async function getAnalytics(range: AnalyticsRange): Promise<ApiResult<AnalyticsReport>> {
  if (API_MODE === "http") return apiFetch<AnalyticsReport>(`/v1/analytics?range=${range}`);
  return read((d) => mockAnalytics(range, d.platforms, d.accounts));
}
