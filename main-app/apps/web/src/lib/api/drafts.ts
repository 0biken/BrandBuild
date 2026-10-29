import { newId, read, write } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, DraftItem } from "./types";

export async function listDrafts(): Promise<ApiResult<DraftItem[]>> {
  if (API_MODE === "http") return apiFetch<DraftItem[]>("/v1/drafts");
  return read((d) => d.drafts);
}

export async function getDraft(id: string): Promise<ApiResult<DraftItem>> {
  if (API_MODE === "http") return apiFetch<DraftItem>(`/v1/drafts/${encodeURIComponent(id)}`);
  const res = await read((d) => d.drafts.find((x) => x.id === id) ?? null);
  if (!res.ok) return res;
  return res.data ? { ok: true, data: res.data } : { ok: false, error: "not_found" };
}

export async function updateDraft(
  id: string,
  patch: Partial<Omit<DraftItem, "id">>,
): Promise<ApiResult<DraftItem>> {
  if (API_MODE === "http") {
    return apiFetch<DraftItem>(`/v1/drafts/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
  }
  return write((d) => {
    const draft = d.drafts.find((x) => x.id === id);
    if (!draft) return "not_found";
    Object.assign(draft, patch, { edited: "Just now" });
    return draft;
  });
}

export async function createDraft(input: Omit<DraftItem, "id">): Promise<ApiResult<DraftItem>> {
  if (API_MODE === "http") return apiFetch<DraftItem>("/v1/drafts", { method: "POST", body: input });
  return write((d) => {
    const draft: DraftItem = { ...input, id: newId("draft") };
    d.drafts.unshift(draft);
    return draft;
  });
}

/** Deletes a draft. Returns its old position so Undo can restore it in place. */
export async function deleteDraft(id: string): Promise<ApiResult<{ index: number }>> {
  if (API_MODE === "http") {
    return apiFetch<{ index: number }>(`/v1/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  return write((d) => {
    const index = d.drafts.findIndex((x) => x.id === id);
    if (index < 0) return "not_found";
    d.drafts.splice(index, 1);
    return { index };
  });
}

/** Undo a delete: the same draft, same id, back where it was. */
export async function restoreDraft(draft: DraftItem, index: number): Promise<ApiResult<DraftItem>> {
  if (API_MODE === "http") {
    return apiFetch<DraftItem>(`/v1/drafts/${encodeURIComponent(draft.id)}/restore`, { method: "POST" });
  }
  return write((d) => {
    if (d.drafts.some((x) => x.id === draft.id)) return "conflict";
    d.drafts.splice(Math.min(index, d.drafts.length), 0, draft);
    return draft;
  });
}
