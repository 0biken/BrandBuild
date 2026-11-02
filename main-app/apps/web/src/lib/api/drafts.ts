import { newId, read, write } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, DraftItem } from "./types";

export async function listDrafts(): Promise<ApiResult<DraftItem[]>> {
  if (API_MODE === "http") return apiFetch<DraftItem[]>("/v1/drafts");
  return read((d) => d.drafts);
}

export async function createDraft(input: Omit<DraftItem, "id">): Promise<ApiResult<DraftItem>> {
  if (API_MODE === "http") return apiFetch<DraftItem>("/v1/drafts", { method: "POST", body: input });
  return write((d) => {
    const draft: DraftItem = { ...input, id: newId("draft") };
    d.drafts.unshift(draft);
    return draft;
  });
}

export async function deleteDraft(id: string): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch(`/v1/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
  return write((d) => {
    const i = d.drafts.findIndex((x) => x.id === id);
    if (i < 0) return "not_found";
    d.drafts.splice(i, 1);
    return undefined;
  });
}
