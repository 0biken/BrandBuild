import { read } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, Brand } from "./types";

export async function getBrand(): Promise<ApiResult<Brand>> {
  if (API_MODE === "http") return apiFetch<Brand>("/v1/brand");
  return read((d) => d.brand);
}
