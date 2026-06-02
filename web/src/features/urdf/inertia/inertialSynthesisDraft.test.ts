/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { buildInertialSynthesisDraft } from "./inertialSynthesisDraft";
import type { InertialSynthesisResult } from "./inertialSynthesis";

const BASE_URDF = `
<robot name="demo">
  <link name="base" />
  <link name="arm">
    <inertial>
      <origin xyz="1 1 1" rpy="0 0 0" />
      <mass value="1" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
  </link>
</robot>
`;

const SYNTHESIS_RESULT: InertialSynthesisResult = {
  robotName: "demo",
  repairMode: "replace-all",
  densityPresetId: "pla",
  densityLabel: "PLA",
  regularizeNearMissTensors: false,
  results: [
    {
      linkName: "base",
      status: "synthesized",
      existingInertialStatus: "missing",
      densityPresetId: "pla",
      densityLabel: "PLA",
      sourceKind: "collision",
      geometryKinds: ["box"],
      mass: 12.5,
      origin: { xyz: [0.1, 0.2, 0.3], rpy: [0, 0, 0] },
      inertia: {
        ixx: 1.1,
        ixy: 0,
        ixz: 0,
        iyy: 1.2,
        iyz: 0,
        izz: 1.3,
      },
      warnings: [],
    },
    {
      linkName: "arm",
      status: "synthesized",
      existingInertialStatus: "valid",
      densityPresetId: "pla",
      densityLabel: "PLA",
      sourceKind: "visual",
      geometryKinds: ["mesh"],
      mass: 5,
      origin: { xyz: [0, 0, 0.5], rpy: [0, 0, 0] },
      inertia: {
        ixx: 2,
        ixy: 0,
        ixz: 0,
        iyy: 3,
        iyz: 0,
        izz: 4,
      },
      warnings: [],
    },
  ],
};

describe("inertialSynthesisDraft", () => {
  it("adds missing inertials and replaces existing inertials for synthesized links", () => {
    const draft = buildInertialSynthesisDraft(BASE_URDF, SYNTHESIS_RESULT);

    expect(draft).toContain('<link name="base"><inertial>');
    expect(draft).toContain('mass value="12.5"');
    expect(draft).toContain('origin xyz="0.1 0.2 0.3" rpy="0 0 0"');
    expect(draft).toContain('mass value="5"');
    expect(draft).toContain('inertia ixx="2" ixy="0" ixz="0" iyy="3" iyz="0" izz="4"');
    expect(draft).not.toContain('origin xyz="1 1 1"');
  });
});
