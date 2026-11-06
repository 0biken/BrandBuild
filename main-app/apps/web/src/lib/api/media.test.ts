import { beforeEach, describe, expect, it } from "vitest";
import { mockConfig, resetMockDb } from "@/lib/mock/store";
import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES, addMedia, listMedia, mediaProblem, removeMedia } from "./media";

const file = (name: string, type: string, size: number) => ({ name, type, size });

beforeEach(() => {
  mockConfig.latencyMs = 0;
  resetMockDb();
  sessionStorage.clear();
});

describe("media import", () => {
  it("accepts common photo and video types", () => {
    expect(mediaProblem(file("a.jpg", "image/jpeg", 1000))).toBeNull();
    expect(mediaProblem(file("a.png", "image/png", 1000))).toBeNull();
    expect(mediaProblem(file("clip.mp4", "video/mp4", 1000))).toBeNull();
    expect(mediaProblem(file("clip.mov", "video/quicktime", 1000))).toBeNull();
  });

  it("rejects other files and oversized ones with a clear reason", () => {
    expect(mediaProblem(file("doc.pdf", "application/pdf", 10))).toMatch(/isn't a supported photo or video/);
    expect(mediaProblem(file("big.jpg", "image/jpeg", IMAGE_MAX_BYTES + 1))).toMatch(/over 10 MB/);
    expect(mediaProblem(file("long.mp4", "video/mp4", VIDEO_MAX_BYTES + 1))).toMatch(/over 200 MB/);
  });

  it("adds a photo to the library and removes it again", async () => {
    const photo = new File([new Uint8Array([1, 2, 3])], "shade.png", { type: "image/png" });
    const added = await addMedia(photo);
    expect(added.ok && added.data.kind).toBe("image");
    const list = await listMedia();
    expect(list.ok && list.data.map((m) => m.name)).toEqual(["shade.png"]);
    if (added.ok) await removeMedia(added.data.id);
    const after = await listMedia();
    expect(after.ok && after.data).toEqual([]);
  });
});
