import { describe, expect, it } from "vitest";
import {
  clampNumber,
  clampNumberToMin,
  clampNumberToOptionalBounds,
  isFiniteNumber,
  isFinitePositiveNumber,
  parseFiniteFloatOrNull,
  toFiniteNumberAtLeastOrFallback,
  toFiniteNumberOrFallback,
  toFiniteNumberOrNull,
  toNonNegativeFiniteNumberOrFallback,
  toNonNegativeFiniteNumberOrNull,
  toPositiveFiniteNumberOrFallback,
  toPositiveFiniteNumberOrNull,
} from "@/shared/lib/numeric";

describe("numeric", () => {
  it("clamps values into a required range", () => {
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(11, 0, 10)).toBe(10);
    expect(clampNumber(5, 0, 10)).toBe(5);
  });

  it("clamps values to a minimum", () => {
    expect(clampNumberToMin(0, 1)).toBe(1);
    expect(clampNumberToMin(3, 1)).toBe(3);
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

  it("falls back and clamps values to a minimum", () => {
    expect(toFiniteNumberAtLeastOrFallback(4, 1)).toBe(4);
    expect(toFiniteNumberAtLeastOrFallback(-1, 0)).toBe(0);
    expect(toFiniteNumberAtLeastOrFallback(Number.NaN, 2)).toBe(2);
    expect(toFiniteNumberAtLeastOrFallback(undefined, 2, 3)).toBe(3);
    expect(toFiniteNumberAtLeastOrFallback(undefined, 2, 1)).toBe(2);
  });

  it("returns null for non-finite values", () => {
    expect(toFiniteNumberOrNull(4)).toBe(4);
    expect(toFiniteNumberOrNull(Number.NaN)).toBeNull();
    expect(toFiniteNumberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFiniteNumberOrNull(undefined)).toBeNull();
  });

  it("returns null for negative or non-finite values", () => {
    expect(toNonNegativeFiniteNumberOrNull(0)).toBe(0);
    expect(toNonNegativeFiniteNumberOrNull(4)).toBe(4);
    expect(toNonNegativeFiniteNumberOrNull(-1)).toBeNull();
    expect(toNonNegativeFiniteNumberOrNull(Number.NaN)).toBeNull();
    expect(toNonNegativeFiniteNumberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("falls back for negative or non-finite values", () => {
    expect(toNonNegativeFiniteNumberOrFallback(0, 9)).toBe(0);
    expect(toNonNegativeFiniteNumberOrFallback(4, 9)).toBe(4);
    expect(toNonNegativeFiniteNumberOrFallback(-1, 9)).toBe(9);
    expect(toNonNegativeFiniteNumberOrFallback(Number.NaN, 9)).toBe(9);
  });

  it("returns null for non-positive or non-finite values", () => {
    expect(toPositiveFiniteNumberOrNull(0.1)).toBe(0.1);
    expect(toPositiveFiniteNumberOrNull(0)).toBeNull();
    expect(toPositiveFiniteNumberOrNull(-1)).toBeNull();
    expect(toPositiveFiniteNumberOrNull(Number.NaN)).toBeNull();
    expect(toPositiveFiniteNumberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("falls back for non-positive or non-finite values", () => {
    expect(toPositiveFiniteNumberOrFallback(0.1, 9)).toBe(0.1);
    expect(toPositiveFiniteNumberOrFallback(0, 9)).toBe(9);
    expect(toPositiveFiniteNumberOrFallback(-1, 9)).toBe(9);
    expect(toPositiveFiniteNumberOrFallback(Number.NaN, 9)).toBe(9);
  });

  it("identifies only finite numbers", () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber("1")).toBe(false);
  });

  it("identifies only finite positive numbers", () => {
    expect(isFinitePositiveNumber(0.1)).toBe(true);
    expect(isFinitePositiveNumber(0)).toBe(false);
    expect(isFinitePositiveNumber(-1)).toBe(false);
    expect(isFinitePositiveNumber(Number.NaN)).toBe(false);
    expect(isFinitePositiveNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFinitePositiveNumber("1")).toBe(false);
  });

  it("parses finite float values or null", () => {
    expect(parseFiniteFloatOrNull("1.25")).toBe(1.25);
    expect(parseFiniteFloatOrNull(" 2.5 ")).toBe(2.5);
    expect(parseFiniteFloatOrNull("abc")).toBeNull();
    expect(parseFiniteFloatOrNull("")).toBeNull();
  });
});
