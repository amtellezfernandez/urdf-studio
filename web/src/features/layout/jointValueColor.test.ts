import { describe, expect, it } from "vitest";

import { getJointValueColor } from "@/features/layout/jointValueColor";

describe("getJointValueColor", () => {
  it("uses the center color when a joint does not have a complete finite range", () => {
    expect(getJointValueColor(0, -1, 1, false)).toBe("#bbf7d0");
    expect(getJointValueColor(0, Number.NaN, 1, true)).toBe("#bbf7d0");
    expect(getJointValueColor(0, -1, Number.POSITIVE_INFINITY, true)).toBe("#bbf7d0");
    expect(getJointValueColor(0, 1, 1, true)).toBe("#bbf7d0");
  });

  it("uses the warning color for an inverted range", () => {
    expect(getJointValueColor(0, 1, -1, true)).toBe("#fef3c7");
  });

  it("keeps mid-range values green and edge values red", () => {
    expect(getJointValueColor(0, -1, 1, true)).toBe("#bbf7d0");
    expect(getJointValueColor(-1, -1, 1, true)).toBe("#fecaca");
    expect(getJointValueColor(1, -1, 1, true)).toBe("#fecaca");
  });

  it("interpolates toward warning near the range edge", () => {
    expect(getJointValueColor(0.25, -1, 1, true)).toBe("#ddf5cc");
  });
});
