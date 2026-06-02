/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { getJointLimits, parseJointLimitsFromURDF } from "@/shared/lib/urdfBrowser";

describe("parseJointLimits", () => {
  it("keeps finite bounds for continuous joints when provided", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="test">
  <link name="base" />
  <link name="tip" />
  <joint name="joint_a" type="continuous">
    <parent link="base" />
    <child link="tip" />
    <limit lower="-2.4" upper="2.1" velocity="1.2" />
  </joint>
</robot>`;

    const limits = parseJointLimitsFromURDF(urdf);
    expect(limits.joint_a?.lower).toBeCloseTo(-2.4);
    expect(limits.joint_a?.upper).toBeCloseTo(2.1);

    const resolved = getJointLimits(limits, "joint_a");
    expect(resolved.lower).toBeCloseTo(-2.4);
    expect(resolved.upper).toBeCloseTo(2.1);
  });

  it("normalizes invalid numeric values to unlimited bounds", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="test">
  <link name="base" />
  <link name="tip" />
  <joint name="joint_b" type="revolute">
    <parent link="base" />
    <child link="tip" />
    <limit lower="not-a-number" upper="1.5" velocity="2.0" />
  </joint>
</robot>`;

    const limits = parseJointLimitsFromURDF(urdf);
    expect(limits.joint_b?.lower).toBeNull();
    expect(limits.joint_b?.upper).toBeCloseTo(1.5);

    const resolved = getJointLimits(limits, "joint_b");
    expect(resolved.lower).toBe(-Infinity);
    expect(resolved.upper).toBeCloseTo(1.5);
  });

  it("swaps inverted finite bounds", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="test">
  <link name="base" />
  <link name="tip" />
  <joint name="joint_c" type="revolute">
    <parent link="base" />
    <child link="tip" />
    <limit lower="2.8" upper="-1.2" velocity="1.0" />
  </joint>
</robot>`;

    const limits = parseJointLimitsFromURDF(urdf);
    expect(limits.joint_c?.lower).toBeCloseTo(-1.2);
    expect(limits.joint_c?.upper).toBeCloseTo(2.8);
  });
});
