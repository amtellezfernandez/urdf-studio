import { describe, expect, it } from "vitest";
import { clampNumber } from "./ikMath";

describe("clampNumber", () => {
  it("bounds values to the configured range", () => {
    expect(clampNumber(-2, -1, 1)).toBe(-1);
    expect(clampNumber(0.5, -1, 1)).toBe(0.5);
    expect(clampNumber(2, -1, 1)).toBe(1);
  });
});
