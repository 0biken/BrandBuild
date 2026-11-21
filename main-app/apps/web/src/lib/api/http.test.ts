import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiUpload } from "./http";

function respond(status: number, body?: unknown) {
  const res = new Response(body === undefined ? null : JSON.stringify(body), { status });
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
}

afterEach(() => vi.restoreAllMocks());

describe("apiFetch", () => {
  it("unwraps the data envelope", async () => {
    respond(200, { data: { id: "a" } });
    expect(await apiFetch("/v1/x")).toEqual({ ok: true, data: { id: "a" } });
  });

  it("treats 204 as success with no data", async () => {
    respond(204);
    expect(await apiFetch("/v1/x")).toEqual({ ok: true, data: undefined });
  });

  it("prefers the error code over the status", async () => {
    respond(401, { error: { code: "code_expired", message: "Expired" } });
    expect(await apiFetch("/v1/x")).toEqual({ ok: false, error: "expired" });
  });

  it("maps the auth and onboarding error codes", async () => {
    respond(403, { error: { code: "email_not_verified", message: "Verify first" } });
    expect(await apiFetch("/v1/x")).toEqual({ ok: false, error: "forbidden" });
    vi.restoreAllMocks();
    respond(503, { error: { code: "email_unavailable", message: "Try later" } });
    expect(await apiFetch("/v1/x")).toEqual({ ok: false, error: "network" });
    vi.restoreAllMocks();
    respond(501, { error: { code: "not_available", message: "Not yet" } });
    expect(await apiFetch("/v1/x")).toEqual({ ok: false, error: "network" });
  });

  it("falls back to the status when the body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }));
    expect(await apiFetch("/v1/x")).toEqual({ ok: false, error: "not_found" });
  });

  it("reports server errors and thrown fetches as network", async () => {
    respond(500, { error: { code: "internal_error", message: "x" } });
    expect(await apiFetch("/v1/x")).toEqual({ ok: false, error: "network" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    expect(await apiFetch("/v1/x")).toEqual({ ok: false, error: "network" });
  });
});

describe("apiUpload", () => {
  it("posts the file as multipart and unwraps the envelope", async () => {
    const spy = respond(201, { data: { id: "m" } });
    const result = await apiUpload("/v1/media", new File(["x"], "a.png"));
    expect(result).toEqual({ ok: true, data: { id: "m" } });
    expect((spy.mock.calls[0][1]?.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("maps upload failures by code", async () => {
    respond(422, { error: { code: "invalid_input", message: "x" } });
    expect(await apiUpload("/v1/media", new File(["x"], "a.png"))).toEqual({ ok: false, error: "invalid" });
  });
});
