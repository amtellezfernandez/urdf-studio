import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it } from "vitest";

import { analyzeUrdfDocument } from "@/shared/lib/urdfCore";
import { parseURDF } from "@/shared/lib/urdfBrowser";
import {
  applyRepeatedInertiaGroupManualFix,
  REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_POSTWRITE_MISMATCH_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_REAL_MISMATCH_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_DIFFERS_TOO_MUCH_ERROR,
  REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR,
  requiresRepeatedInertiaGeometryRegen,
} from "@/features/urdf/inertia/repeatedInertiaManualFix";
import fs from "node:fs";
import type { MeshFiles } from "@/shared/types/feature";

const REPEATED_GROUP_URDF = `
<robot name="repeated_manual_fix_robot">
  <link name="wheel_a">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </visual>
    <inertial>
      <origin xyz="0.01 0 0" rpy="0 0 0" />
      <mass value="1.0" />
      <inertia ixx="3" ixy="0" ixz="0" iyy="2" iyz="0" izz="1" />
    </inertial>
  </link>
  <link name="wheel_b">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </visual>
    <inertial>
      <origin xyz="0.01 0 0" rpy="0 0 0" />
      <mass value="1.0" />
      <inertia ixx="3" ixy="0" ixz="0" iyy="2" iyz="0" izz="1" />
    </inertial>
  </link>
  <link name="wheel_c">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </visual>
    <inertial>
      <origin xyz="0.01 0 0" rpy="0 0 0" />
      <mass value="1.0" />
      <inertia ixx="3" ixy="0" ixz="0" iyy="2" iyz="0" izz="1" />
    </inertial>
  </link>
</robot>
`;

const REPEATED_GROUP_COLLISION_URDF = `
<robot name="repeated_manual_fix_robot">
  <link name="wheel_a">
    <collision>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </collision>
    <inertial>
      <origin xyz="0.01 0 0" rpy="0 0 0" />
      <mass value="1.0" />
      <inertia ixx="3" ixy="0" ixz="0" iyy="2" iyz="0" izz="1" />
    </inertial>
  </link>
  <link name="wheel_b">
    <collision>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </collision>
    <inertial>
      <origin xyz="0.01 0 0" rpy="0 0 0" />
      <mass value="1.0" />
      <inertia ixx="3" ixy="0" ixz="0" iyy="2" iyz="0" izz="1" />
    </inertial>
  </link>
  <link name="wheel_c">
    <collision>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </collision>
    <inertial>
      <origin xyz="0.01 0 0" rpy="0 0 0" />
      <mass value="1.0" />
      <inertia ixx="3" ixy="0" ixz="0" iyy="2" iyz="0" izz="1" />
    </inertial>
  </link>
</robot>
`;

const UNIT_CUBE_STL = `
solid cube
  facet normal 0 0 1
    outer loop
      vertex 0 0 1
      vertex 1 0 1
      vertex 1 1 1
    endloop
  endfacet
  facet normal 0 0 1
    outer loop
      vertex 0 0 1
      vertex 1 1 1
      vertex 0 1 1
    endloop
  endfacet
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 1 1 0
      vertex 1 0 0
    endloop
  endfacet
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 0 1 0
      vertex 1 1 0
    endloop
  endfacet
  facet normal 0 1 0
    outer loop
      vertex 0 1 0
      vertex 0 1 1
      vertex 1 1 1
    endloop
  endfacet
  facet normal 0 1 0
    outer loop
      vertex 0 1 0
      vertex 1 1 1
      vertex 1 1 0
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 0 0 0
      vertex 1 0 1
      vertex 0 0 1
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 1 0 1
    endloop
  endfacet
  facet normal 1 0 0
    outer loop
      vertex 1 0 0
      vertex 1 1 1
      vertex 1 0 1
    endloop
  endfacet
  facet normal 1 0 0
    outer loop
      vertex 1 0 0
      vertex 1 1 0
      vertex 1 1 1
    endloop
  endfacet
  facet normal -1 0 0
    outer loop
      vertex 0 0 0
      vertex 0 0 1
      vertex 0 1 1
    endloop
  endfacet
  facet normal -1 0 0
    outer loop
      vertex 0 0 0
      vertex 0 1 1
      vertex 0 1 0
    endloop
  endfacet
endsolid cube
`;

const HIGH_SPREAD_URDF = `
<robot name="repeated_manual_fix_robot">
  <link name="wheel_a">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </visual>
    <inertial>
      <origin xyz="0.01 0 0" rpy="0 0 0" />
      <mass value="1.0" />
      <inertia ixx="3" ixy="0" ixz="0" iyy="2" iyz="0" izz="1" />
    </inertial>
  </link>
  <link name="wheel_b">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </visual>
    <inertial>
      <origin xyz="0.03 0 0" rpy="0 0 0" />
      <mass value="1.3" />
      <inertia ixx="4.5" ixy="0" ixz="0" iyy="2.5" iyz="0" izz="1.2" />
    </inertial>
  </link>
</robot>
`;

const analyzeUrdf = (content: string) => {
  const parsed = parseURDF(content);
  return analyzeUrdfDocument(parsed.document);
};

const LEKIWI_DEMO_URDF = fs.readFileSync("web/public/demo/lekiwi.urdf", "utf8");
const LEKIWI_WHEEL_MESH_REFERENCE = "meshes/4-Omni-Directional-Wheel_Single_Body-v1.stl";
const LEKIWI_WHEEL_GROUP_KEY =
  "collision:meshes/4-Omni-Directional-Wheel_Single_Body-v1.stl:0.001 0.001 0.001";

const createMeshFiles = (entries: Record<string, string>): MeshFiles =>
  Object.fromEntries(
    Object.entries(entries).map(([reference, filePath]) => [
      reference,
      new Blob([fs.readFileSync(filePath)], { type: "model/stl" }),
    ])
  );

const LEKIWI_WHEEL_MESH_FILES = createMeshFiles({
  [LEKIWI_WHEEL_MESH_REFERENCE]:
    "web/public/demo/meshes/4-Omni-Directional-Wheel_Single_Body-v1.stl",
});

describe("applyRepeatedInertiaGroupManualFix", () => {
  beforeAll(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;
  });

  it("treats an already-consistent repeated group as a no-op", async () => {
    const analysis = analyzeUrdf(REPEATED_GROUP_URDF);

    const result = await applyRepeatedInertiaGroupManualFix({
      urdfContent: REPEATED_GROUP_URDF,
      urdfAnalysis: analysis,
      groupKey: "visual:meshes/shared_wheel.stl:1 1 1",
      meshFiles: {},
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: REPEATED_INERTIA_MANUAL_FIX_ALREADY_CONSISTENT_ERROR,
      })
    );
  });

  it("refuses direct fixes when the group exceeds the safety envelope", async () => {
    const analysis = analyzeUrdf(HIGH_SPREAD_URDF);

    const result = await applyRepeatedInertiaGroupManualFix({
      urdfContent: HIGH_SPREAD_URDF,
      urdfAnalysis: analysis,
      groupKey: "visual:meshes/shared_wheel.stl:1 1 1",
      meshFiles: {},
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error:
          "This repeated group has real mass/COM/inertia mismatch. Direct group fix is disabled; use geometry-based regeneration for this group.",
      })
    );
  });

  it("refuses direct fixes that would turn the group low-confidence against geometry", async () => {
    const analysis = analyzeUrdf(REPEATED_GROUP_COLLISION_URDF);

    const result = await applyRepeatedInertiaGroupManualFix({
      urdfContent: REPEATED_GROUP_COLLISION_URDF,
      urdfAnalysis: analysis,
      groupKey: "collision:meshes/shared_wheel.stl:1 1 1",
      meshFiles: {
        "meshes/shared_wheel.stl": new Blob([UNIT_CUBE_STL], { type: "model/stl" }),
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR,
      })
    );
  });

  it("flags geometry regeneration for every fail-closed manual-fix mismatch error", () => {
    expect(requiresRepeatedInertiaGeometryRegen(REPEATED_INERTIA_MANUAL_FIX_REAL_MISMATCH_ERROR)).toBe(
      true
    );
    expect(
      requiresRepeatedInertiaGeometryRegen(REPEATED_INERTIA_MANUAL_FIX_POSTWRITE_MISMATCH_ERROR)
    ).toBe(true);
    expect(requiresRepeatedInertiaGeometryRegen(REPEATED_INERTIA_MANUAL_FIX_DIFFERS_TOO_MUCH_ERROR)).toBe(
      true
    );
    expect(requiresRepeatedInertiaGeometryRegen(REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR)).toBe(
      true
    );
    expect(requiresRepeatedInertiaGeometryRegen("some other error")).toBe(false);
  });

  it("preserves the demo omni wheel orientation-defining tensor terms during a direct fix", async () => {
    const analysis = analyzeUrdf(LEKIWI_DEMO_URDF);

    const result = await applyRepeatedInertiaGroupManualFix({
      urdfContent: LEKIWI_DEMO_URDF,
      urdfAnalysis: analysis,
      groupKey: LEKIWI_WHEEL_GROUP_KEY,
      meshFiles: LEKIWI_WHEEL_MESH_FILES,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: REPEATED_INERTIA_MANUAL_FIX_LOW_CONFIDENCE_ERROR,
      })
    );
  });
});
