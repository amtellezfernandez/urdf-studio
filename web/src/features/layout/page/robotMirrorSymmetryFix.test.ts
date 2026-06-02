import { JSDOM } from "jsdom";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { analyzeUrdfDocument } from "@/shared/lib/urdfCore";
import { parseURDF } from "@/shared/lib/urdfBrowser";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import {
  applyRobotMirrorParallelFix,
  applyRobotMirrorSymmetryFix,
  resolveRobotMirrorActionableSelection,
} from "@/features/layout/page/robotMirrorSymmetryFix";
import { parseRepeatedInertiaSymmetryRobot } from "@/features/layout/page/repeatedInertiaSymmetryRobot";

const CENTERLINE_OFFSET_METERS = 0.003;
const FAR_CENTERLINE_OFFSET_METERS = 0.004;
const AMBIGUOUS_CAMERA_TILT_RADIANS = Math.PI / 4;
const EXACT_ALIGNMENT_DOT_THRESHOLD = 0.9999;
const PLANE_POSITION_TOLERANCE_METERS = 1e-6;
const ORIENTATION_PRESERVATION_TOLERANCE_RADIANS = 1e-6;
const CENTER_OFFSET_CAMERA_FIXTURE = {
  inertialCenterOffsetMeters: 0.02,
} as const;

const TILTED_CENTERLINK_URDF = `
<robot name="mirror-centerline-test">
  <link name="base_link" />
  <joint name="base_to_centerline_box" type="fixed">
    <parent link="base_link" />
    <child link="centerline_box" />
    <origin xyz="0 ${CENTERLINE_OFFSET_METERS} 0" rpy="0.4 0 0" />
  </joint>
  <link name="centerline_box">
    <visual>
      <geometry>
        <box size="0.2 0.04 0.02" />
      </geometry>
    </visual>
  </link>
</robot>
`.trim();

const TILTED_CAMERA_LINK_URDF = `
<robot name="mirror-camera-test">
  <link name="base_link" />
  <joint name="base_to_camera_move_v31" type="fixed">
    <parent link="base_link" />
    <child link="camera_move_v31" />
    <origin xyz="0 ${FAR_CENTERLINE_OFFSET_METERS} 0" rpy="0 0 0" />
  </joint>
  <link name="camera_move_v31">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 ${AMBIGUOUS_CAMERA_TILT_RADIANS}" />
      <mass value="1" />
      <inertia ixx="0.02" ixy="0" ixz="0" iyy="0.03" iyz="0" izz="0.04" />
    </inertial>
    <visual>
      <geometry>
        <box size="0.2 0.04 0.02" />
      </geometry>
    </visual>
  </link>
</robot>
`.trim();

const ON_PLANE_TILTED_CAMERA_LINK_URDF = `
<robot name="mirror-camera-preview-test">
  <link name="base_link" />
  <joint name="base_to_camera_move_v31" type="fixed">
    <parent link="base_link" />
    <child link="camera_move_v31" />
    <origin xyz="0 0 0" rpy="0 0 0" />
  </joint>
  <link name="camera_move_v31">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 ${AMBIGUOUS_CAMERA_TILT_RADIANS}" />
      <mass value="1" />
      <inertia ixx="0.02" ixy="0" ixz="0" iyy="0.03" iyz="0" izz="0.04" />
    </inertial>
    <visual>
      <geometry>
        <box size="0.2 0.04 0.02" />
      </geometry>
    </visual>
  </link>
</robot>
`.trim();

const ON_PLANE_CENTER_OFFSET_CAMERA_LINK_URDF = `
<robot name="mirror-camera-center-offset-test">
  <link name="base_link" />
  <joint name="base_to_camera_move_v31" type="fixed">
    <parent link="base_link" />
    <child link="camera_move_v31" />
    <origin xyz="0 0 0" rpy="0 0 0" />
  </joint>
  <link name="camera_move_v31">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="1" />
      <inertia ixx="0.02" ixy="0" ixz="0" iyy="0.03" iyz="0" izz="0.04" />
    </inertial>
    <collision>
      <origin xyz="0 ${CENTER_OFFSET_CAMERA_FIXTURE.inertialCenterOffsetMeters} 0" rpy="0 0 0" />
      <geometry>
        <box size="0.2 0.04 0.02" />
      </geometry>
    </collision>
  </link>
</robot>
`.trim();

const ALIGNED_CENTERLINE_BOX_URDF = `
<robot name="mirror-centerline-preview-test">
  <link name="base_link" />
  <joint name="base_to_centerline_box" type="fixed">
    <parent link="base_link" />
    <child link="centerline_box" />
    <origin xyz="0 0 0" rpy="0 0 0" />
  </joint>
  <link name="centerline_box">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="1" />
      <inertia ixx="0.02" ixy="0" ixz="0" iyy="0.03" iyz="0" izz="0.04" />
    </inertial>
    <visual>
      <geometry>
        <box size="0.2 0.04 0.02" />
      </geometry>
    </visual>
  </link>
</robot>
`.trim();

const ON_PLANE_UNVERIFIED_LINK_URDF = `
<robot name="mirror-unverified-preview-test">
  <link name="base_link" />
  <joint name="base_to_unverified_centerline_box" type="fixed">
    <parent link="base_link" />
    <child link="unverified_centerline_box" />
    <origin xyz="0 0 0" rpy="0 0 0" />
  </joint>
  <link name="unverified_centerline_box">
    <visual>
      <geometry>
        <box size="0.2 0.04 0.02" />
      </geometry>
    </visual>
  </link>
</robot>
`.trim();

const ROBOT_MIRROR_CHECK: RobotMirrorSymmetryCheck = {
  averageResidualMeters: 0,
  centeredLinkCount: 1,
  centeredLinkNames: ["centerline_box"],
  matchedPairs: [],
  matchedPairCount: 0,
  maxResidualMeters: 0,
  originMeters: [0, 0, 0],
  pairedGroupCount: 0,
  pairedLinkCount: 0,
  planeLabel: "xz",
  planeNormalWorld: [0, 1, 0],
  reviewGroups: [],
  reviewLinkCount: 0,
  supportedGroupCount: 1,
  supportedLinkCount: 1,
  supportedLinkNames: ["centerline_box"],
  totalRepeatedLinkCount: 1,
};

const buildWorldAxes = (matrix: THREE.Matrix4): THREE.Vector3[] => {
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
  return [
    new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).normalize(),
    new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize(),
    new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize(),
  ];
};

describe("applyRobotMirrorSymmetryFix", () => {
  beforeAll(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
    globalThis.XMLSerializer = dom.window.XMLSerializer as unknown as typeof XMLSerializer;
  });

  it("aligns a tilted centerline link to the symmetry plane orientation as well as position", () => {
    const result = applyRobotMirrorSymmetryFix({
      fixMode: "full-align",
      robotMirrorSymmetryCheck: ROBOT_MIRROR_CHECK,
      selectedLinkNames: ["centerline_box"],
      selectionLinks: [
        {
          counterpartLinkName: null,
          defaultExclusionReason: null,
          groupKey: "group:centerline-box",
          groupLinkCount: 1,
          linkName: "centerline_box",
          meshLabel: "centerline-box",
          preselected: true,
          status: "centered",
        },
      ],
      urdfContent: TILTED_CENTERLINK_URDF,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.linkResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linkName: "centerline_box",
          orientationDecision: "align-to-plane",
          orientationSkipReason: null,
          repairMode: "position-and-orientation",
        }),
      ])
    );

    const repairedRobot = parseRepeatedInertiaSymmetryRobot(result.draftUrdfContent);
    expect(repairedRobot).not.toBeNull();
    const repairedMatrix = repairedRobot?.linkWorldMatrices.get("centerline_box") ?? null;
    expect(repairedMatrix).not.toBeNull();

    const repairedPosition = repairedRobot?.linkWorldPositions.get("centerline_box") ?? null;
    expect(Math.abs(repairedPosition?.y ?? Number.POSITIVE_INFINITY)).toBeLessThan(
      PLANE_POSITION_TOLERANCE_METERS
    );

    const planeNormal = new THREE.Vector3(0, 1, 0);
    const worldAxes = repairedMatrix === null ? [] : buildWorldAxes(repairedMatrix);
    const bestAxisAlignment =
      repairedMatrix === null
        ? 0
        : Math.max(
            ...worldAxes.map((axisWorld) =>
              Math.abs(axisWorld.dot(planeNormal))
            )
          );
    expect(bestAxisAlignment).toBeGreaterThan(EXACT_ALIGNMENT_DOT_THRESHOLD);
    const inPlaneAxisDots = worldAxes
      .map((axisWorld) => Math.abs(axisWorld.dot(planeNormal)))
      .sort((left, right) => right - left);
    expect(inPlaneAxisDots[1] ?? 1).toBeLessThan(PLANE_POSITION_TOLERANCE_METERS);
    expect(inPlaneAxisDots[2] ?? 1).toBeLessThan(PLANE_POSITION_TOLERANCE_METERS);
    expect(result.appliedStepCount).toBeGreaterThan(0);
  });

  it("keeps the current orientation when the exact snap would require a large rotation", () => {
    const originalRobot = parseRepeatedInertiaSymmetryRobot(TILTED_CAMERA_LINK_URDF);
    const originalMatrix = originalRobot?.linkWorldMatrices.get("camera_move_v31") ?? null;
    const originalQuaternion =
      originalMatrix === null ? null : new THREE.Quaternion().setFromRotationMatrix(originalMatrix);

    const result = applyRobotMirrorSymmetryFix({
      fixMode: "center-only",
      robotMirrorSymmetryCheck: {
        ...ROBOT_MIRROR_CHECK,
        centeredLinkCount: 1,
        centeredLinkNames: ["camera_move_v31"],
        supportedLinkCount: 1,
        supportedLinkNames: ["camera_move_v31"],
      },
      selectedLinkNames: ["camera_move_v31"],
      selectionLinks: [
        {
          counterpartLinkName: null,
          defaultExclusionReason: null,
          groupKey: "group:camera-move-v31",
          groupLinkCount: 1,
          linkName: "camera_move_v31",
          meshLabel: "camera-move-v31",
          preselected: true,
          status: "centered",
        },
      ],
      urdfContent: TILTED_CAMERA_LINK_URDF,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.linkResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linkName: "camera_move_v31",
          orientationDecision: "preserve-current",
          orientationSkipReason: null,
          repairMode: "position-only",
        }),
      ])
    );

    const repairedRobot = parseRepeatedInertiaSymmetryRobot(result.draftUrdfContent);
    const repairedMatrix = repairedRobot?.linkWorldMatrices.get("camera_move_v31") ?? null;
    const repairedQuaternion =
      repairedMatrix === null ? null : new THREE.Quaternion().setFromRotationMatrix(repairedMatrix);
    const repairedPosition = repairedRobot?.linkWorldPositions.get("camera_move_v31") ?? null;

    expect(Math.abs(repairedPosition?.y ?? Number.POSITIVE_INFINITY)).toBeLessThan(
      PLANE_POSITION_TOLERANCE_METERS
    );
    expect(repairedQuaternion).not.toBeNull();
    expect(originalQuaternion).not.toBeNull();
    expect(repairedQuaternion?.angleTo(originalQuaternion ?? new THREE.Quaternion())).toBeLessThan(
      ORIENTATION_PRESERVATION_TOLERANCE_RADIANS
    );
  });

  it("can force an inertia-box plane alignment without moving the current link position", async () => {
    const originalRobot = parseRepeatedInertiaSymmetryRobot(TILTED_CAMERA_LINK_URDF);
    const originalPosition = originalRobot?.linkWorldPositions.get("camera_move_v31") ?? null;
    const result = await applyRobotMirrorParallelFix({
      meshFiles: {},
      robotMirrorSymmetryCheck: {
        ...ROBOT_MIRROR_CHECK,
        centeredLinkCount: 1,
        centeredLinkNames: ["camera_move_v31"],
        supportedLinkCount: 1,
        supportedLinkNames: ["camera_move_v31"],
      },
      selectedLinkNames: ["camera_move_v31"],
      selectionLinks: [
        {
          counterpartLinkName: null,
          defaultExclusionReason: null,
          groupKey: "group:camera-move-v31",
          groupLinkCount: 1,
          linkName: "camera_move_v31",
          meshLabel: "camera-move-v31",
          preselected: true,
          status: "centered",
        },
      ],
      urdfContent: TILTED_CAMERA_LINK_URDF,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.linkResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linkName: "camera_move_v31",
          orientationDecision: "align-to-plane",
          orientationSkipReason: null,
          repairMode: "orientation-only",
        }),
      ])
    );

    const repairedRobot = parseRepeatedInertiaSymmetryRobot(result.draftUrdfContent);
    const repairedMatrix = repairedRobot?.linkWorldMatrices.get("camera_move_v31") ?? null;
    const repairedPosition = repairedRobot?.linkWorldPositions.get("camera_move_v31") ?? null;
    const worldAxes = repairedMatrix === null ? [] : buildWorldAxes(repairedMatrix);
    const planeNormal = new THREE.Vector3(0, 1, 0);
    const bestAxisAlignment =
      repairedMatrix === null
        ? 0
        : Math.max(...worldAxes.map((axisWorld) => Math.abs(axisWorld.dot(planeNormal))));

    expect(bestAxisAlignment).toBeGreaterThan(EXACT_ALIGNMENT_DOT_THRESHOLD);
    expect(
      repairedPosition?.distanceTo(originalPosition ?? new THREE.Vector3(Number.NaN, 0, 0)) ??
        Number.POSITIVE_INFINITY
    ).toBeLessThan(PLANE_POSITION_TOLERANCE_METERS);
  });

  it("includes orientation-only mirror targets in the actionable preview highlight set", async () => {
    const selection = await resolveRobotMirrorActionableSelection({
      meshFiles: {},
      robotMirrorSymmetryCheck: {
        ...ROBOT_MIRROR_CHECK,
        centeredLinkCount: 1,
        centeredLinkNames: ["camera_move_v31"],
        supportedLinkCount: 1,
        supportedLinkNames: ["camera_move_v31"],
      },
      selectedLinkNames: ["camera_move_v31"],
      selectionLinks: [
        {
          counterpartLinkName: null,
          defaultExclusionReason: null,
          groupKey: "group:camera-move-v31",
          groupLinkCount: 1,
          linkName: "camera_move_v31",
          meshLabel: "camera-move-v31",
          preselected: true,
          status: "centered",
        },
      ],
      urdfContent: ON_PLANE_TILTED_CAMERA_LINK_URDF,
    });

    expect(selection.visualizationLinkNames).toEqual(["camera_move_v31"]);
    expect(selection.deemphasizedVisualizationLinkNames).toEqual([]);
    expect(selection.availability.centerOnlyAvailable).toBe(false);
    expect(selection.availability.centerOnlyActionableTargetCount).toBe(0);
    expect(selection.availability.orientationOnlyAvailable).toBe(true);
    expect(selection.availability.orientationOnlyActionableTargetCount).toBe(1);
  });

  it("recenters an already-parallel selected inertia box onto its reference geometry", async () => {
    const result = await applyRobotMirrorParallelFix({
      meshFiles: {},
      robotMirrorSymmetryCheck: {
        ...ROBOT_MIRROR_CHECK,
        centeredLinkCount: 1,
        centeredLinkNames: ["camera_move_v31"],
        supportedLinkCount: 1,
        supportedLinkNames: ["camera_move_v31"],
      },
      selectedLinkNames: ["camera_move_v31"],
      selectionLinks: [
        {
          counterpartLinkName: null,
          defaultExclusionReason: null,
          groupKey: "group:camera-move-v31",
          groupLinkCount: 1,
          linkName: "camera_move_v31",
          meshLabel: "camera-move-v31",
          preselected: true,
          status: "centered",
        },
      ],
      urdfContent: ON_PLANE_CENTER_OFFSET_CAMERA_LINK_URDF,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.linkResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inertialOriginMovedDistanceMeters:
            CENTER_OFFSET_CAMERA_FIXTURE.inertialCenterOffsetMeters,
          linkName: "camera_move_v31",
          repairMode: "inertia-center-only",
          rotationAppliedRadians: 0,
        }),
      ])
    );

    const repairedLinkData =
      analyzeUrdfDocument(parseURDF(result.draftUrdfContent).document).linkDataByName[
        "camera_move_v31"
      ];
    expect(repairedLinkData?.inertial?.origin.xyz[1]).toBeCloseTo(
      CENTER_OFFSET_CAMERA_FIXTURE.inertialCenterOffsetMeters
    );
  });

  it("includes center-offset-only inertia boxes in the actionable preview highlight set", async () => {
    const selection = await resolveRobotMirrorActionableSelection({
      meshFiles: {},
      robotMirrorSymmetryCheck: {
        ...ROBOT_MIRROR_CHECK,
        centeredLinkCount: 1,
        centeredLinkNames: ["camera_move_v31"],
        supportedLinkCount: 1,
        supportedLinkNames: ["camera_move_v31"],
      },
      selectedLinkNames: ["camera_move_v31"],
      selectionLinks: [
        {
          counterpartLinkName: null,
          defaultExclusionReason: null,
          groupKey: "group:camera-move-v31",
          groupLinkCount: 1,
          linkName: "camera_move_v31",
          meshLabel: "camera-move-v31",
          preselected: true,
          status: "centered",
        },
      ],
      urdfContent: ON_PLANE_CENTER_OFFSET_CAMERA_LINK_URDF,
    });

    expect(selection.visualizationLinkNames).toEqual(["camera_move_v31"]);
    expect(selection.deemphasizedVisualizationLinkNames).toEqual([]);
    expect(selection.availability.orientationOnlyAvailable).toBe(true);
    expect(selection.availability.orientationOnlyActionableTargetCount).toBe(1);
  });

  it("keeps selected plane-touching centerline links highlighted even when no automatic delta remains", async () => {
    const selection = await resolveRobotMirrorActionableSelection({
      alwaysIncludeVisualizationLinkNames: ["centerline_box"],
      meshFiles: {},
      robotMirrorSymmetryCheck: ROBOT_MIRROR_CHECK,
      selectedLinkNames: ["centerline_box"],
      selectionLinks: [
        {
          counterpartLinkName: null,
          defaultExclusionReason: null,
          groupKey: "group:centerline-box",
          groupLinkCount: 1,
          linkName: "centerline_box",
          meshLabel: "centerline-box",
          preselected: true,
          status: "centered",
        },
      ],
      urdfContent: ALIGNED_CENTERLINE_BOX_URDF,
    });

    expect(selection.visualizationLinkNames).toEqual(["centerline_box"]);
    expect(selection.deemphasizedVisualizationLinkNames).toEqual(["centerline_box"]);
    expect(selection.availability.centerOnlyAvailable).toBe(false);
    expect(selection.availability.centerOnlyActionableTargetCount).toBe(0);
    expect(selection.availability.orientationOnlyAvailable).toBe(false);
    expect(selection.availability.orientationOnlyActionableTargetCount).toBe(0);
  });

  it("does not deemphasize plane-touching links that cannot be verified as aligned", async () => {
    const selection = await resolveRobotMirrorActionableSelection({
      alwaysIncludeVisualizationLinkNames: ["unverified_centerline_box"],
      meshFiles: {},
      robotMirrorSymmetryCheck: {
        ...ROBOT_MIRROR_CHECK,
        centeredLinkNames: ["unverified_centerline_box"],
        supportedLinkNames: ["unverified_centerline_box"],
      },
      selectedLinkNames: ["unverified_centerline_box"],
      selectionLinks: [
        {
          counterpartLinkName: null,
          defaultExclusionReason: null,
          groupKey: "group:unverified-centerline-box",
          groupLinkCount: 1,
          linkName: "unverified_centerline_box",
          meshLabel: "unverified-centerline-box",
          preselected: true,
          status: "centered",
        },
      ],
      urdfContent: ON_PLANE_UNVERIFIED_LINK_URDF,
    });

    expect(selection.visualizationLinkNames).toEqual(["unverified_centerline_box"]);
    expect(selection.deemphasizedVisualizationLinkNames).toEqual([]);
  });
});
