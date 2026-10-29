import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { invalidate, useQuery } from "./hooks";

describe("useQuery", () => {
  it("refetches a sub-key when its prefix is invalidated", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => ({ ok: true as const, data: ++n }));
    const { result } = renderHook(() => useQuery("posts:abc", fetcher));
    await waitFor(() => expect(result.current.data).toBe(1));

    act(() => invalidate("posts"));
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not refetch unrelated keys", async () => {
    const fetcher = vi.fn(async () => ({ ok: true as const, data: "x" }));
    const { result } = renderHook(() => useQuery("drafts:only", fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => invalidate("posts"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
