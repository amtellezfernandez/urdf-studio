/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { analyzeUrdf } from "@/shared/lib/urdfCore";
import {
  buildInertialAuditSummary,
  buildInertialPlausibilitySummary,
  buildInertialSynthesisSummary,
  canonicalizeRepeatedMeshSynthesisResults,
  synthesizeInertialsFromGeometry,
} from "./inertialSynthesis";

const BOX_COLLISION_URDF = `
<robot name="box_robot">
  <link name="base">
    <collision>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <box size="1 2 3" />
      </geometry>
    </collision>
  </link>
</robot>
`;

const VISUAL_MESH_URDF = `
<robot name="mesh_robot">
  <link name="mesh_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/tetra.obj" scale="1 1 1" />
      </geometry>
    </visual>
  </link>
</robot>
`;

const MISSING_MESH_URDF = `
<robot name="missing_mesh_robot">
  <link name="missing_link">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/missing.obj" scale="1 1 1" />
      </geometry>
    </visual>
  </link>
</robot>
`;

const AUTHORED_MISSING_MESH_URDF = `
<robot name="authored_missing_mesh_robot">
  <link name="missing_link">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="1" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/missing.obj" scale="1 1 1" />
      </geometry>
    </visual>
  </link>
</robot>
`;

const AUTHORED_GHOST_MESH_URDF = `
<robot name="authored_ghost_mesh_robot">
  <link name="ghost_link">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="1" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/ghost.obj" scale="1 1 1" />
      </geometry>
    </visual>
  </link>
</robot>
`;

const REPEATED_MESH_URDF = `
<robot name="repeated_mesh_robot">
  <link name="wheel_a">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </visual>
  </link>
  <link name="wheel_b">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </visual>
  </link>
  <link name="wheel_c">
    <visual>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="meshes/shared_wheel.stl" scale="1 1 1" />
      </geometry>
    </visual>
  </link>
</robot>
`;

const TETRA_OBJ = `
o tetra
v 0 0 0
v 1 0 0
v 0 1 0
v 0 0 1
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
`;

const OPEN_CUBE_OBJ = `
o open_cube
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3
f 1 3 4
f 1 5 6
f 1 6 2
f 2 6 7
f 2 7 3
f 3 7 8
f 3 8 4
f 4 8 5
f 4 5 1
`;

const buildBoxObjPart = ({
  size,
  center,
  vertexOffset,
}: {
  size: number;
  center: [number, number, number];
  vertexOffset: number;
}): { text: string; nextVertexOffset: number } => {
  const half = size / 2;
  const [cx, cy, cz] = center;
  const vertices = [
    [cx - half, cy - half, cz - half],
    [cx + half, cy - half, cz - half],
    [cx + half, cy + half, cz - half],
    [cx - half, cy + half, cz - half],
    [cx - half, cy - half, cz + half],
    [cx + half, cy - half, cz + half],
    [cx + half, cy + half, cz + half],
    [cx - half, cy + half, cz + half],
  ];
  const faces = [
    [1, 2, 3], [1, 3, 4],
    [5, 7, 6], [5, 8, 7],
    [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3],
    [3, 7, 8], [3, 8, 4],
    [4, 8, 5], [4, 5, 1],
  ].map((face) => face.map((index) => index + vertexOffset));
  return {
    text: [
    ...vertices.map((vertex) => `v ${vertex.join(" ")}`),
    ...faces.map((face) => `f ${face.join(" ")}`),
    ].join("\n"),
    nextVertexOffset: vertexOffset + vertices.length,
  };
};

const buildCombinedBoxObj = (entries: Array<{ size: number; center: [number, number, number] }>): string => {
  let vertexOffset = 0;
  const parts: string[] = [];
  entries.forEach((entry) => {
    const result = buildBoxObjPart({
      size: entry.size,
      center: entry.center,
      vertexOffset,
    });
    parts.push(result.text);
    vertexOffset = result.nextVertexOffset;
  });
  return parts.join("\n");
};

const NEGLIGIBLE_DUST_SIZE = 0.04;
const NEGLIGIBLE_DUST_CENTERS: Array<[number, number, number]> = [
  [0.56, 0, 0],
  [-0.56, 0, 0],
  [0, 0.56, 0],
  [0, -0.56, 0],
  [0, 0, 0.56],
  [0, 0, -0.56],
  [0.56, 0.18, 0],
  [-0.56, -0.18, 0],
  [0, 0.56, 0.18],
  [0, -0.56, -0.18],
];

const DIRTY_CAD_OBJ = buildCombinedBoxObj([
  { size: 1, center: [0, 0, 0] },
  ...NEGLIGIBLE_DUST_CENTERS.map((center) => ({ size: NEGLIGIBLE_DUST_SIZE, center })),
]);

const EXCESSIVE_CLEANUP_OBJ = buildCombinedBoxObj([
  { size: 1, center: [0, 0, 0] },
  { size: 0.34, center: [4, 0, 0] },
  { size: 0.34, center: [-4, 0, 0] },
]);

const GHOST_CLEANUP_OBJ = buildCombinedBoxObj([
  { size: 1, center: [0, 0, 0] },
  ...Array.from({ length: 420 }, (_, index) => ({
    size: 0.36,
    center: [3 + (index % 30), Math.floor(index / 30), 0] as [number, number, number],
  })),
]);

describe("inertialSynthesis", () => {
  it("synthesizes exact collision-first inertials for a primitive box", async () => {
    const result = await synthesizeInertialsFromGeometry({
      urdfAnalysis: analyzeUrdf(BOX_COLLISION_URDF),
      densityPresetId: "pla",
    });

    expect(result).not.toBeNull();
    const synthesized = result?.results[0];
    expect(synthesized?.status).toBe("synthesized");
    expect(synthesized?.sourceKind).toBe("collision");
    expect(synthesized?.mass).toBeCloseTo(7440, 6);
    expect(synthesized?.origin?.xyz).toEqual([0, 0, 0]);
    expect(synthesized?.inertia?.ixx).toBeCloseTo(8060, 6);
    expect(synthesized?.inertia?.iyy).toBeCloseTo(6200, 6);
    expect(synthesized?.inertia?.izz).toBeCloseTo(3100, 6);
  });

  it("falls back to visual mesh geometry when collision geometry is absent", async () => {
    const result = await synthesizeInertialsFromGeometry({
      urdfAnalysis: analyzeUrdf(VISUAL_MESH_URDF),
      densityPresetId: "pla",
      meshFiles: {
        "meshes/tetra.obj": new Blob([TETRA_OBJ], { type: "text/plain" }),
      },
    });

    expect(result).not.toBeNull();
    const synthesized = result?.results[0];
    expect(synthesized?.status).toBe("synthesized");
    expect(synthesized?.sourceKind).toBe("visual");
    expect(synthesized?.mass).toBeCloseTo(1240 / 6, 3);
    expect(synthesized?.origin?.xyz[0]).toBeCloseTo(0.25, 3);
    expect(synthesized?.origin?.xyz[1]).toBeCloseTo(0.25, 3);
    expect(synthesized?.origin?.xyz[2]).toBeCloseTo(0.25, 3);
    expect((synthesized?.warnings.length ?? 0) > 0).toBe(false);
  });

  it("synthesizes an open mesh that would otherwise be excluded", async () => {
    const result = await synthesizeInertialsFromGeometry({
      urdfAnalysis: analyzeUrdf(VISUAL_MESH_URDF),
      densityPresetId: "pla",
      meshFiles: {
        "meshes/tetra.obj": new Blob([OPEN_CUBE_OBJ], { type: "text/plain" }),
      },
    });

    expect(result).not.toBeNull();
    const synthesized = result?.results[0];
    expect(synthesized?.status).toBe("synthesized");
    expect((synthesized?.mass ?? 0) > 0).toBe(true);
  });

  it("supports explicit voxel-only synthesis for recovery runs", async () => {
    const result = await synthesizeInertialsFromGeometry({
      urdfAnalysis: analyzeUrdf(VISUAL_MESH_URDF),
      densityPresetId: "pla",
      meshSolveMode: "voxel-only",
      meshFiles: {
        "meshes/tetra.obj": new Blob([TETRA_OBJ], { type: "text/plain" }),
      },
    });

    expect(result).not.toBeNull();
    const synthesized = result?.results[0];
    expect(synthesized?.status).toBe("synthesized");
    expect(synthesized?.warnings.some((warning) => warning.code === "voxel-fallback")).toBe(true);
  });

  it("sanitizes small disconnected mesh islands before synthesis", async () => {
    const result = await synthesizeInertialsFromGeometry({
      urdfAnalysis: analyzeUrdf(VISUAL_MESH_URDF),
      densityPresetId: "pla",
      meshFiles: {
        "meshes/tetra.obj": new Blob([DIRTY_CAD_OBJ], { type: "text/plain" }),
      },
    });

    const synthesized = result?.results[0];
    expect(synthesized?.status).toBe("synthesized");
    expect(synthesized?.mass).toBeCloseTo(1240, 3);
    expect(synthesized?.warnings.some((warning) => warning.code === "mesh-sanitized")).toBe(true);
    expect(synthesized?.meshSanitization?.[0]?.removedComponents).toBe(10);
    expect((synthesized?.meshSanitization?.[0]?.volumeRetainedRatio ?? 0) > 0.99).toBe(true);
  });

  it("excludes meshes that would require excessive disconnected-component cleanup", async () => {
    const result = await synthesizeInertialsFromGeometry({
      urdfAnalysis: analyzeUrdf(VISUAL_MESH_URDF),
      densityPresetId: "pla",
      meshFiles: {
        "meshes/tetra.obj": new Blob([EXCESSIVE_CLEANUP_OBJ], { type: "text/plain" }),
      },
    });

    const synthesized = result?.results[0];
    expect(synthesized?.status).toBe("skipped");
    expect(synthesized?.warnings.some((warning) => warning.code === "excessive-cleanup")).toBe(true);
    expect(synthesized?.meshSanitization?.[0]?.status).toBe("excessive-deletion");
  });

  it("skips unresolved mesh geometry and reports a warning", async () => {
    const result = await synthesizeInertialsFromGeometry({
      urdfAnalysis: analyzeUrdf(MISSING_MESH_URDF),
      densityPresetId: "pla",
      meshFiles: {},
    });

    expect(result).not.toBeNull();
    const synthesized = result?.results[0];
    expect(synthesized?.status).toBe("skipped");
    expect(synthesized?.warnings[0]?.code).toBe("unresolved-mesh-reference");
    const summary = buildInertialSynthesisSummary(result);
    expect(summary?.skippedLinkCount).toBe(1);
    expect(summary?.warningCount).toBe(1);
  });

  it("marks unresolved excluded links as not voxel-recoverable in plausibility preflight", async () => {
    const plausibility = await buildInertialPlausibilitySummary({
      urdfAnalysis: analyzeUrdf(AUTHORED_MISSING_MESH_URDF),
      meshFiles: {},
    });

    expect(plausibility?.excludedLinks).toHaveLength(1);
    expect(plausibility?.excludedLinks[0]).toMatchObject({
      linkName: "missing_link",
      reason: "unresolved-mesh-reference",
      recoveryAction: null,
      recoveryEligible: false,
      recoveryMessage: null,
    });
  });

  it("auto-excludes ghost geometry when cleanup would discard nearly all skipped mass", async () => {
    const plausibility = await buildInertialPlausibilitySummary({
      urdfAnalysis: analyzeUrdf(AUTHORED_GHOST_MESH_URDF),
      meshFiles: {
        "meshes/ghost.obj": new Blob([GHOST_CLEANUP_OBJ], { type: "text/plain" }),
      },
    });

    expect(plausibility?.excludedLinks).toHaveLength(1);
    expect(plausibility?.excludedLinks[0]).toMatchObject({
      linkName: "ghost_link",
      reason: "excessive-cleanup",
      recoveryDisposition: "auto-exclude-ghost",
      recoveryAction: null,
      recoveryEligible: false,
    });
    expect(plausibility?.excludedLinks[0]?.recoveryMessage).toContain("Treat it as ghost geometry");
  });

  it("defaults to repairing only missing or invalid inertials", async () => {
    const urdf = `
<robot name="repair_robot">
  <link name="valid_link">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="2" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
    <collision><geometry><box size="1 1 1" /></geometry></collision>
  </link>
  <link name="missing_link">
    <collision><geometry><box size="1 1 1" /></geometry></collision>
  </link>
</robot>
`;
    const analysis = analyzeUrdf(urdf);
    const audit = buildInertialAuditSummary(analysis);
    expect(audit?.presentLinkCount).toBe(1);
    expect(audit?.validLinkCount).toBe(1);
    expect(audit?.missingLinkCount).toBe(1);

    const result = await synthesizeInertialsFromGeometry({
      urdfAnalysis: analysis,
      densityPresetId: "pla",
    });

    expect(result?.repairMode).toBe("repair-missing-invalid");
    expect(result?.results.find((entry) => entry.linkName === "valid_link")?.status).toBe("skipped");
    expect(result?.results.find((entry) => entry.linkName === "missing_link")?.status).toBe(
      "synthesized"
    );
  });

  it("canonicalizes repeated pure-mesh inertias by median consensus", () => {
    const analysis = analyzeUrdf(REPEATED_MESH_URDF);
    expect(analysis?.isValid).toBe(true);

    const canonicalized = canonicalizeRepeatedMeshSynthesisResults({
      linkDataByName: analysis?.isValid ? analysis.linkDataByName : {},
      results: [
        {
          linkName: "wheel_a",
          status: "synthesized",
          existingInertialStatus: "missing",
          densityPresetId: "pla",
          densityLabel: "PLA",
          sourceKind: "visual",
          geometryKinds: ["mesh"],
          mass: 1.0,
          origin: { xyz: [0.01, 0, 0], rpy: [0, 0, 0] },
          inertia: { ixx: 3, ixy: 0, ixz: 0, iyy: 2, iyz: 0, izz: 1 },
          warnings: [],
          diagnostics: null,
          meshSanitization: [],
        },
        {
          linkName: "wheel_b",
          status: "synthesized",
          existingInertialStatus: "missing",
          densityPresetId: "pla",
          densityLabel: "PLA",
          sourceKind: "visual",
          geometryKinds: ["mesh"],
          mass: 1.001,
          origin: { xyz: [0.0104, 0, 0], rpy: [0, 0, 0] },
          inertia: { ixx: 3.012, ixy: 0, ixz: 0, iyy: 2.004, iyz: 0, izz: 1.002 },
          warnings: [],
          diagnostics: null,
          meshSanitization: [],
        },
        {
          linkName: "wheel_c",
          status: "synthesized",
          existingInertialStatus: "missing",
          densityPresetId: "pla",
          densityLabel: "PLA",
          sourceKind: "visual",
          geometryKinds: ["mesh"],
          mass: 0.999,
          origin: { xyz: [0.0098, 0, 0], rpy: [0, 0, 0] },
          inertia: { ixx: 2.994, ixy: 0, ixz: 0, iyy: 1.998, iyz: 0, izz: 0.999 },
          warnings: [],
          diagnostics: null,
          meshSanitization: [],
        },
      ],
    });

    expect(canonicalized.summaries).toContainEqual(
      expect.objectContaining({
        strategy: "median-consensus",
        meshReference: "meshes/shared_wheel.stl",
      })
    );
    canonicalized.results.forEach((result) => {
      if (result.status !== "synthesized") {
        return;
      }
      expect(result.mass).toBe(1);
      expect(result.origin?.xyz).toEqual([0.01, 0, 0]);
      expect(result.inertia).toEqual({
        ixx: 3,
        ixy: 0,
        ixz: 0,
        iyy: 2,
        iyz: 0,
        izz: 1,
      });
      expect(result.warnings.some((warning) => warning.code === "repeated-mesh-canonicalized")).toBe(true);
    });
  });

  it("refuses repeated-mesh canonicalization when spread exceeds the safety envelope", () => {
    const analysis = analyzeUrdf(REPEATED_MESH_URDF);
    expect(analysis?.isValid).toBe(true);

    const canonicalized = canonicalizeRepeatedMeshSynthesisResults({
      linkDataByName: analysis?.isValid ? analysis.linkDataByName : {},
      results: [
        {
          linkName: "wheel_a",
          status: "synthesized",
          existingInertialStatus: "missing",
          densityPresetId: "pla",
          densityLabel: "PLA",
          sourceKind: "visual",
          geometryKinds: ["mesh"],
          mass: 1,
          origin: { xyz: [0.01, 0, 0], rpy: [0, 0, 0] },
          inertia: { ixx: 3, ixy: 0, ixz: 0, iyy: 2, iyz: 0, izz: 1 },
          warnings: [],
          diagnostics: null,
          meshSanitization: [],
        },
        {
          linkName: "wheel_b",
          status: "synthesized",
          existingInertialStatus: "missing",
          densityPresetId: "pla",
          densityLabel: "PLA",
          sourceKind: "visual",
          geometryKinds: ["mesh"],
          mass: 1.3,
          origin: { xyz: [0.02, 0, 0], rpy: [0, 0, 0] },
          inertia: { ixx: 4.5, ixy: 0, ixz: 0, iyy: 2.5, iyz: 0, izz: 1.2 },
          warnings: [],
          diagnostics: null,
          meshSanitization: [],
        },
      ],
    });

    expect(canonicalized.summaries).toContainEqual(
      expect.objectContaining({
        strategy: "skipped",
      })
    );
    expect(canonicalized.results[0]?.mass).toBe(1);
    expect(canonicalized.results[1]?.mass).toBe(1.3);
    expect(
      canonicalized.results.some((result) =>
        result.warnings.some((warning) => warning.code === "repeated-mesh-canonicalized")
      )
    ).toBe(false);
  });

  it("flags authored mass that exceeds the geometry-derived heavy-material envelope", async () => {
    const urdf = `
<robot name="implausible_robot">
  <link name="heavy_box_a">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="5" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
    <collision><geometry><box size="0.05 0.05 0.05" /></geometry></collision>
  </link>
  <link name="heavy_box_b">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="5" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
    <collision><geometry><box size="0.05 0.05 0.05" /></geometry></collision>
  </link>
  <link name="heavy_box_c">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="5" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
    <collision><geometry><box size="0.05 0.05 0.05" /></geometry></collision>
  </link>
</robot>
`;
    const plausibility = await buildInertialPlausibilitySummary({
      urdfAnalysis: analyzeUrdf(urdf),
    });

    expect(plausibility?.verdict).toBe("mass-too-high");
    expect(plausibility?.warning).toContain("exceeds the geometry-derived heavy-material estimate");
    expect(plausibility?.offenders[0]?.linkName).toBe("heavy_box_a");
  });
});
