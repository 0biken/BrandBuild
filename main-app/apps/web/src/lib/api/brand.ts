import { read, write } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { fromApiBrand, mapResult, type ApiBrand } from "./adapt";
import { apiFetch } from "./http";
import type { ApiResult, Brand, BrandProfile } from "./types";

export async function getBrand(): Promise<ApiResult<Brand>> {
  if (API_MODE === "http") return mapResult(await apiFetch<ApiBrand>("/v1/brand"), fromApiBrand);
  return read((d) => d.brand);
}

export async function updateBrand(profile: BrandProfile): Promise<ApiResult<Brand>> {
  if (API_MODE === "http") return mapResult(await apiFetch<ApiBrand>("/v1/brand", { method: "PUT", body: profile }), fromApiBrand);
  if (!profile.name.trim()) return { ok: false, error: "invalid" };
  if (profile.tones.length < 1 || profile.tones.length > 2) return { ok: false, error: "invalid" };
  return write((d) => {
    Object.assign(d.brand, profile, { voice: profile.tones.join(", ").toLowerCase() });
    return d.brand;
  });
}
