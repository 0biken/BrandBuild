import { describe, expect, it } from "vitest";
import { toggleTone } from "./tones";

describe("toggleTone", () => {
  it("adds a second tone", () => {
    expect(toggleTone(["Warm"], "Bold")).toEqual(["Warm", "Bold"]);
  });
  it("replaces the oldest when a third is picked", () => {
    expect(toggleTone(["Warm", "Playful"], "Bold")).toEqual(["Playful", "Bold"]);
  });
  it("removes a picked tone", () => {
    expect(toggleTone(["Warm", "Playful"], "Warm")).toEqual(["Playful"]);
  });
  it("keeps the last tone", () => {
    const one = ["Warm"] as const;
    expect(toggleTone([...one], "Warm")).toEqual(["Warm"]);
  });
});
