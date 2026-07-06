import { describe, expect, it } from "vitest";
import {
  clampNumber,
  clampNumberToOptionalBounds,
  toFiniteNumberOrFallback,
} from "@/shared/lib/numeric";

describe("numeric", () => {
  it("clamps values into a required range", () => {
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(11, 0, 10)).toBe(10);
    expect(clampNumber(5, 0, 10)).toBe(5);
  });

  it("clamps values with optional bounds", () => {
    expect(clampNumberToOptionalBounds(5, {})).toBe(5);
    expect(clampNumberToOptionalBounds(5, { min: 7 })).toBe(7);
    expect(clampNumberToOptionalBounds(5, { max: 3 })).toBe(3);
    expect(clampNumberToOptionalBounds(5, { min: 1, max: 3 })).toBe(3);
  });

  it("falls back for non-finite values", () => {
    expect(toFiniteNumberOrFallback(4, 9)).toBe(4);
    expect(toFiniteNumberOrFallback(Number.NaN, 9)).toBe(9);
    expect(toFiniteNumberOrFallback(Number.POSITIVE_INFINITY, 9)).toBe(9);
    expect(toFiniteNumberOrFallback(undefined, 9)).toBe(9);
  });
});
