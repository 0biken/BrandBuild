import { describe, expect, it } from "vitest";
import { shortWhen, timeAgo } from "./postDates";

describe("timeAgo", () => {
  const now = new Date("2026-11-02T12:00:00");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

  it.each([
    [0, "just now"],
    [5, "5 min ago"],
    [60, "1 hour ago"],
    [180, "3 hours ago"],
    [25 * 60, "yesterday"],
    [3 * 24 * 60, "3 days ago"],
  ])("%i minutes → %s", (min, text) => {
    expect(timeAgo(ago(min), now)).toBe(text);
  });

  it("treats a bad timestamp as just now", () => {
    expect(timeAgo("nope", now)).toBe("just now");
  });
});

describe("shortWhen", () => {
  it("drops the comma and year", () => {
    expect(shortWhen({ dateStr: "Sat, 7 Nov 2026", time: "6:00 PM" })).toBe("Sat 7 Nov, 6:00 PM");
  });
});
