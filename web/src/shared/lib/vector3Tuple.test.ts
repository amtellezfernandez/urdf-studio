import { describe, expect, it } from "vitest";
import {
  formatVector3Tuple,
  parseVector3Tuple,
  toVector3Tuple,
  updateVector3TupleValue,
} from "@/shared/lib/vector3Tuple";

describe("vector3Tuple", () => {
  it("parses finite vector components with per-axis fallback values", () => {
    expect(parseVector3Tuple("1 bad 3", [4, 5, 6])).toEqual([1, 5, 3]);
  });

  it("converts vector-like values to tuples", () => {
    expect(toVector3Tuple({ x: 1, y: 2, z: 3 })).toEqual([1, 2, 3]);
  });

  it("formats and updates vector tuples", () => {
    expect(formatVector3Tuple(updateVector3TupleValue([1, 2, 3], 1, 9))).toBe("1 9 3");
  });
});
