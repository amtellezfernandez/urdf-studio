import { describe, expect, it } from "vitest";

import { getJointLimitsError } from "@/shared/lib/jointLimits";

describe("jointLimits", () => {
  it("allows omitted or fully non-finite limits", () => {
    expect(getJointLimitsError()).toBeNull();
    expect(getJointLimitsError(null, undefined)).toBeNull();
    expect(getJointLimitsError(Number.NaN, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("requires lower and upper limits together", () => {
    expect(getJointLimitsError(-1, undefined)).toBe("Both lower and upper limits are required");
    expect(getJointLimitsError(undefined, 1, "elbow")).toBe(
      'Both lower and upper limits are required for joint "elbow"'
    );
  });

  it("rejects lower limits above upper limits", () => {
    expect(getJointLimitsError(2, 1)).toBe("Lower limit must be <= upper limit");
    expect(getJointLimitsError(2, 1, "shoulder")).toBe(
      'Lower limit must be <= upper limit for joint "shoulder"'
    );
  });

  it("accepts ordered finite limits", () => {
    expect(getJointLimitsError(-1, 1)).toBeNull();
    expect(getJointLimitsError(1, 1)).toBeNull();
  });
});
