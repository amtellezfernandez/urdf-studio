import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { buildOperatorPointCloudPoseTransform } from "@/features/teleop/perception/operatorPointCloudPose";
import {
  OPENARM_HF_LIVE_REAL_SENSE_POSE,
  OPENARM_HF_LIVE_REAL_SENSE_POSITION_M,
} from "@/features/teleop/perception/openArmHfLiveParams";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";

const TEST_POINT_CLOUD_POSE_FIXTURE = {
  positionHfYUp: [1, 2, 3] as [number, number, number],
  positionUrdfZUp: [3, 1, 2],
  zeroRotationRpyDeg: [0, 0, 0] as [number, number, number],
  scale: 0.001,
  expectedForwardUrdfZUp: new THREE.Vector3(1, 0, 0),
  openArmPoseUrdfZUp: [...OPENARM_HF_LIVE_REAL_SENSE_POSITION_M],
  openArmForwardDownDotMin: 0.99,
  hfLevelGravity: [0, -1, 0] as [number, number, number],
} as const;

const buildCameraPose = (
  overrides: Partial<NonNullable<OperatorPointCloudFrame["cameraPose"]>>
): NonNullable<OperatorPointCloudFrame["cameraPose"]> => ({
  position: TEST_POINT_CLOUD_POSE_FIXTURE.positionHfYUp,
  rotationRpyDeg: TEST_POINT_CLOUD_POSE_FIXTURE.zeroRotationRpyDeg,
  scale: TEST_POINT_CLOUD_POSE_FIXTURE.scale,
  ...overrides,
});

describe("operatorPointCloudPose", () => {
  it("converts Hugging Face y-up OpenArm poses into URDF Studio z-up world poses", () => {
    const transform = buildOperatorPointCloudPoseTransform(
      buildCameraPose({ worldFrame: "hf_y_up" })
    );
    const transformedForward = new THREE.Vector3(0, 0, 1).applyQuaternion(transform.quaternion);

    expect(transform.position).toEqual(TEST_POINT_CLOUD_POSE_FIXTURE.positionUrdfZUp);
    expect(transform.pointScale).toBe(TEST_POINT_CLOUD_POSE_FIXTURE.scale);
    expect(transformedForward.x).toBeCloseTo(
      TEST_POINT_CLOUD_POSE_FIXTURE.expectedForwardUrdfZUp.x
    );
    expect(transformedForward.y).toBeCloseTo(
      TEST_POINT_CLOUD_POSE_FIXTURE.expectedForwardUrdfZUp.y
    );
    expect(transformedForward.z).toBeCloseTo(
      TEST_POINT_CLOUD_POSE_FIXTURE.expectedForwardUrdfZUp.z
    );
  });

  it("keeps already-normalized URDF z-up poses in place", () => {
    const transform = buildOperatorPointCloudPoseTransform(
      buildCameraPose({ worldFrame: "urdf_z_up" })
    );
    const transformedForward = new THREE.Vector3(0, 0, 1).applyQuaternion(transform.quaternion);

    expect(transform.position).toEqual(TEST_POINT_CLOUD_POSE_FIXTURE.positionHfYUp);
    expect(transform.pointScale).toBe(TEST_POINT_CLOUD_POSE_FIXTURE.scale);
    expect(transformedForward.x).toBeCloseTo(0);
    expect(transformedForward.y).toBeCloseTo(0);
    expect(transformedForward.z).toBeCloseTo(1);
  });

  it("does not let Hugging Face gravity metadata rotate URDF z-up poses", () => {
    const transform = buildOperatorPointCloudPoseTransform(
      buildCameraPose({
        worldFrame: "urdf_z_up",
        gravity: TEST_POINT_CLOUD_POSE_FIXTURE.hfLevelGravity,
      })
    );
    const transformedForward = new THREE.Vector3(0, 0, 1).applyQuaternion(transform.quaternion);

    expect(transformedForward.x).toBeCloseTo(0);
    expect(transformedForward.y).toBeCloseTo(0);
    expect(transformedForward.z).toBeCloseTo(1);
  });

  it("aims the direct OpenArm RealSense from above toward the workspace", () => {
    const transform = buildOperatorPointCloudPoseTransform(OPENARM_HF_LIVE_REAL_SENSE_POSE);
    const transformedForward = new THREE.Vector3(0, 0, 1).applyQuaternion(transform.quaternion);
    const transformedImageColumn = new THREE.Vector3(1, 0, 0).applyQuaternion(
      transform.quaternion,
    );

    expect(transform.position).toEqual(TEST_POINT_CLOUD_POSE_FIXTURE.openArmPoseUrdfZUp);
    expect(
      transformedForward.dot(new THREE.Vector3(0, 0, -1)),
    ).toBeGreaterThan(TEST_POINT_CLOUD_POSE_FIXTURE.openArmForwardDownDotMin);
    expect(Math.abs(transformedImageColumn.z)).toBeLessThan(0.1);
  });

  it("ignores live Hugging Face gravity metadata unless explicitly requested", () => {
    const staticTransform = buildOperatorPointCloudPoseTransform(
      buildCameraPose({ worldFrame: "hf_y_up", rotationRpyDeg: [0, 45, 0] })
    );
    const gravityTransform = buildOperatorPointCloudPoseTransform(
      buildCameraPose({
        worldFrame: "hf_y_up",
        rotationRpyDeg: [0, 45, 0],
        gravity: TEST_POINT_CLOUD_POSE_FIXTURE.hfLevelGravity,
      })
    );
    const staticForward = new THREE.Vector3(0, 0, 1).applyQuaternion(staticTransform.quaternion);
    const gravityForward = new THREE.Vector3(0, 0, 1).applyQuaternion(gravityTransform.quaternion);

    expect(gravityForward.distanceTo(staticForward)).toBeCloseTo(0);
  });

  it("uses live Hugging Face gravity metadata when the camera opts in", () => {
    const staticTransform = buildOperatorPointCloudPoseTransform(
      buildCameraPose({ worldFrame: "hf_y_up", rotationRpyDeg: [0, 45, 0] })
    );
    const gravityTransform = buildOperatorPointCloudPoseTransform(
      buildCameraPose({
        worldFrame: "hf_y_up",
        rotationRpyDeg: [0, 45, 0],
        gravity: TEST_POINT_CLOUD_POSE_FIXTURE.hfLevelGravity,
        useGravityOrientation: true,
      })
    );
    const staticForward = new THREE.Vector3(0, 0, 1).applyQuaternion(staticTransform.quaternion);
    const gravityForward = new THREE.Vector3(0, 0, 1).applyQuaternion(gravityTransform.quaternion);

    expect(gravityForward.distanceTo(staticForward)).toBeGreaterThan(0.5);
    expect(gravityForward.x).toBeCloseTo(TEST_POINT_CLOUD_POSE_FIXTURE.expectedForwardUrdfZUp.x);
  });
});
