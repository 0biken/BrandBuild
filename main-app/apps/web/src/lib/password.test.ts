import { describe, expect, it } from "vitest";
import { passwordRules, passwordValid } from "./password";

describe("password rules", () => {
  it("reports each rule separately", () => {
    expect(passwordRules("abc").map((r) => r.ok)).toEqual([false, true, false, false]);
  });

  it("accepts a password meeting all four rules", () => {
    expect(passwordValid("Glossdrop26")).toBe(true);
  });

  it("rejects a long password with no number", () => {
    expect(passwordValid("Glossdropped")).toBe(false);
  });
});
