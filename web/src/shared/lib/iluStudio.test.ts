/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import {
  buildRobotOrientationCard,
  healthCheckUrdf,
  normalizeRobot,
} from "@/shared/lib/urdfCore";
import { fixMeshPaths } from "@/shared/lib/urdfBrowser";

import {
  alignUrdfToStudioOrientation,
  checkIluUrdfPhysicsHealth,
  getIluRobotOrientationCard,
  repairMeshPathsWithIlu,
  type IluOrientationAlignment,
} from "./iluStudio";

const SIMPLE_URDF = `<?xml version="1.0"?>
<robot name="demo_bot">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </collision>
    <inertial>
      <mass value="1" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
  </link>
</robot>`;

const MESH_PATH_URDF = `<?xml version="1.0"?>
<robot name="demo_bot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/../arm.stl" />
      </geometry>
    </visual>
  </link>
</robot>`;

const TEST_ALIGNMENT: IluOrientationAlignment = {
  sourceUpAxis: "+x",
  sourceForwardAxis: "+y",
  targetUpAxis: "+z",
  targetForwardAxis: "+x",
};

describe("iluStudio", () => {
  it("matches i-love-urdf orientation card generation", () => {
    expect(getIluRobotOrientationCard(SIMPLE_URDF)).toEqual(
      buildRobotOrientationCard(SIMPLE_URDF)
    );
  });

  it("matches i-love-urdf physics health analysis", () => {
    expect(checkIluUrdfPhysicsHealth(SIMPLE_URDF)).toEqual(
      healthCheckUrdf(SIMPLE_URDF)
    );
  });

  it("matches i-love-urdf mesh path repair", () => {
    expect(repairMeshPathsWithIlu(MESH_PATH_URDF)).toEqual(
      fixMeshPaths(MESH_PATH_URDF)
    );
  });

  it("matches i-love-urdf normalization output when aligning orientation", () => {
    const expected = normalizeRobot(SIMPLE_URDF, {
      apply: true,
      sourceUpAxis: TEST_ALIGNMENT.sourceUpAxis,
      sourceForwardAxis: TEST_ALIGNMENT.sourceForwardAxis,
      targetUpAxis: TEST_ALIGNMENT.targetUpAxis,
      targetForwardAxis: TEST_ALIGNMENT.targetForwardAxis,
    });

    expect(expected.outputUrdf).toBeDefined();
    expect(alignUrdfToStudioOrientation(SIMPLE_URDF, TEST_ALIGNMENT)).toBe(
      expected.outputUrdf
    );
  });
});
