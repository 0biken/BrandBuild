import { newId, read, write, type MockDb } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, BrandFact, BrandFactInput } from "./types";

/**
 * Brand facts: offers, prices, opening hours and claims. The AI planner only states a
 * fact an owner or reviewer has verified, and any edit needs verifying again.
 */

const enc = encodeURIComponent;
const KINDS = ["offer", "price", "hours", "claim", "other"] as const;

const facts = (d: MockDb) => (d.facts ??= []);

/** "expired" once its end or expiry date has passed, whatever it was before. */
function withStatus(f: BrandFact): BrandFact {
  const past = (at?: string) => !!at && new Date(at).getTime() <= Date.now();
  return past(f.endsAt) || past(f.expiresAt) ? { ...f, status: "expired" } : f;
}

function cleanPrice(price: BrandFactInput["price"]): string | undefined | "invalid" {
  if (price === null || price === undefined || price === "") return undefined;
  const text = String(price).trim().replace(/,/g, "");
  return /^\d{1,10}(\.\d{1,2})?$/.test(text) ? text : "invalid";
}

function valid(input: BrandFactInput) {
  return (
    (!input.kind || KINDS.includes(input.kind)) &&
    (input.label === undefined || (input.label.trim().length > 0 && input.label.length <= 200)) &&
    (input.value === undefined || (input.value.trim().length > 0 && input.value.length <= 1000)) &&
    cleanPrice(input.price) !== "invalid" &&
    (!input.currency || /^[A-Z]{3}$/.test(input.currency))
  );
}

export async function listFacts(): Promise<ApiResult<BrandFact[]>> {
  if (API_MODE === "http") return apiFetch<BrandFact[]>("/v1/brand/facts");
  return read((d) => facts(d).map(withStatus));
}

export async function createFact(input: BrandFactInput): Promise<ApiResult<BrandFact>> {
  if (API_MODE === "http") return apiFetch<BrandFact>("/v1/brand/facts", { method: "POST", body: input });
  if (!input.kind || !input.label?.trim() || !input.value?.trim() || !valid(input)) return { ok: false, error: "invalid" };
  return write((d) => {
    const fact: BrandFact = withStatus({
      id: newId("fact"),
      kind: input.kind!,
      label: input.label!.trim(),
      value: input.value!.trim(),
      price: cleanPrice(input.price) as string | undefined,
      currency: input.currency ?? undefined,
      endsAt: input.endsAt ?? undefined,
      source: input.source ?? undefined,
      status: "unverified",
      updatedAt: new Date().toISOString(),
    });
    facts(d).unshift(fact);
    return fact;
  });
}

export async function updateFact(id: string, input: BrandFactInput): Promise<ApiResult<BrandFact>> {
  if (API_MODE === "http") return apiFetch<BrandFact>(`/v1/brand/facts/${enc(id)}`, { method: "PATCH", body: input });
  if (!valid(input)) return { ok: false, error: "invalid" };
  return write((d) => {
    const fact = facts(d).find((f) => f.id === id);
    if (!fact) return "not_found";
    const price = input.price === undefined ? fact.price : (cleanPrice(input.price) as string | undefined);
    Object.assign(fact, {
      ...(input.kind && { kind: input.kind }),
      ...(input.label !== undefined && { label: input.label.trim() }),
      ...(input.value !== undefined && { value: input.value.trim() }),
      price,
      ...(input.currency !== undefined && { currency: input.currency ?? undefined }),
      ...(input.endsAt !== undefined && { endsAt: input.endsAt ?? undefined }),
      status: "unverified",
      verifiedAt: undefined,
      updatedAt: new Date().toISOString(),
    });
    return withStatus(fact);
  });
}

export async function deleteFact(id: string): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch(`/v1/brand/facts/${enc(id)}`, { method: "DELETE" });
  return write((d) => {
    const i = facts(d).findIndex((f) => f.id === id);
    if (i < 0) return "not_found";
    facts(d).splice(i, 1);
    return undefined;
  });
}

/** Owners and reviewers confirm a fact is true as written. */
export async function verifyFact(id: string): Promise<ApiResult<BrandFact>> {
  if (API_MODE === "http") return apiFetch<BrandFact>(`/v1/brand/facts/${enc(id)}/verify`, { method: "POST" });
  return write((d) => {
    if (d.session.role === "editor") return "forbidden";
    const fact = facts(d).find((f) => f.id === id);
    if (!fact) return "not_found";
    if (withStatus(fact).status === "expired") return "conflict";
    Object.assign(fact, { status: "verified", verifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return fact;
  });
}
