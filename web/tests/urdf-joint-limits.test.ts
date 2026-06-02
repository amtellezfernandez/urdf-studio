import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { changeJointLimits, changeJointVelocity } from "@/features/urdf/editor/urdfEditorActions";
import { parseJointLimitsFromURDF } from "@/shared/lib/urdfCore";

const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;

const baseUrdf = `
<robot name="test_bot">
  <link name="base" />
  <link name="link1" />
  <joint name="joint1" type="revolute">
    <parent link="base" />
    <child link="link1" />
    <limit lower="-1.0" upper="1.0" velocity="1.0" />
  </joint>
</robot>
`;

describe("changeJointLimits", () => {
  it("updates lower/upper limits in the URDF", () => {
    const result = changeJointLimits(baseUrdf, "joint1", -0.5, 0.75);
    expect(result.success).toBe(true);

    const parsed = parseJointLimitsFromURDF(result.content);
    expect(parsed.joint1.lower).toBeCloseTo(-0.5);
    expect(parsed.joint1.upper).toBeCloseTo(0.75);
  });

  it("creates limit tags when missing", () => {
    const urdfNoLimit = `
      <robot name="test_bot">
        <link name="base" />
        <link name="link1" />
        <joint name="joint2" type="revolute">
          <parent link="base" />
          <child link="link1" />
        </joint>
      </robot>
    `;
    const result = changeJointLimits(urdfNoLimit, "joint2", -1.2, 1.4);
    expect(result.success).toBe(true);
    const parsed = parseJointLimitsFromURDF(result.content);
    expect(parsed.joint2.lower).toBeCloseTo(-1.2);
    expect(parsed.joint2.upper).toBeCloseTo(1.4);
  });
});

describe("changeJointVelocity", () => {
  it("updates velocity limits in the URDF", () => {
    const result = changeJointVelocity(baseUrdf, "joint1", 2.5);
    expect(result.success).toBe(true);

    const parsed = parseJointLimitsFromURDF(result.content);
    expect(parsed.joint1.velocity).toBeCloseTo(2.5);
  });
});
