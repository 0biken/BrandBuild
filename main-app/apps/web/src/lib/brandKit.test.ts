import { describe, expect, it } from "vitest";
import { BRAND_FONTS, fontStack, isHex, logoProblem } from "./brandKit";

describe("brand kit", () => {
  it("checks logo files", () => {
    expect(logoProblem({ type: "image/svg+xml", size: 2000 })).toBeNull();
    expect(logoProblem({ type: "image/gif", size: 2000 })).toMatch(/PNG, JPG, WebP or SVG/);
    expect(logoProblem({ type: "image/png", size: 3 * 1024 * 1024 })).toMatch(/over 2 MB/);
  });

  it("only takes full hex colours", () => {
    expect(isHex("#0F2A1B")).toBe(true);
    expect(isHex("#0F2A1")).toBe(false);
    expect(isHex("red")).toBe(false);
  });

  it("falls back to the default font for unknown names", () => {
    expect(fontStack("Nope")).toBe(BRAND_FONTS[0].stack);
    expect(fontStack("Poppins")).toContain("Poppins");
  });
});
