/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { computeInertialStats } from "./computeCenterOfMass";

describe("computeInertialStats", () => {
  it("ignores fixed self-collision helper links for missing inertial warnings", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="demo">
  <link name="base">
    <inertial>
      <mass value="1.0"/>
      <inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/>
    </inertial>
    <visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual>
  </link>
  <link name="panda_1_link0_sc">
    <collision><geometry><box size="0.1 0.1 0.1"/></geometry></collision>
  </link>
  <joint name="helper_fixed" type="fixed">
    <parent link="base"/>
    <child link="panda_1_link0_sc"/>
  </joint>
</robot>`;

    const stats = computeInertialStats(null, urdf);
    expect(stats.totalLinks).toBe(1);
    expect(stats.missingInertialLinks).toEqual([]);
  });

  it("flags non-fixed dynamics links that are missing inertial", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="demo">
  <link name="base">
    <inertial>
      <mass value="2.0"/>
      <inertia ixx="0.2" ixy="0" ixz="0" iyy="0.2" iyz="0" izz="0.2"/>
    </inertial>
  </link>
  <link name="arm"/>
  <joint name="shoulder" type="revolute">
    <parent link="base"/>
    <child link="arm"/>
    <axis xyz="0 0 1"/>
  </joint>
</robot>`;

    const stats = computeInertialStats(null, urdf);
    expect(stats.totalLinks).toBe(2);
    expect(stats.contributingLinks).toBe(1);
    expect(stats.missingInertialLinks).toEqual(["arm"]);
  });
});
