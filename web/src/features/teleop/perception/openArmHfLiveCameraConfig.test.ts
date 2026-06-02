import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { toCameraIconDisplayQuaternion } from "@/features/camera/cameraIconMath";
import {
  resolveOpenArmHfLiveCameraConfigPose,
  resolveOpenArmHfLiveCameraConfigPoseFromPointCloudPose,
} from "@/features/teleop/perception/openArmHfLiveCameraConfig";
import {
  OPENARM_HF_LIVE_CAMERA_RPY_RAD,
  OPENARM_HF_LIVE_CAMERA_ID,
  OPENARM_HF_LIVE_REAL_SENSE_POSE,
  OPENARM_HF_LIVE_REAL_SENSE_POSITION_M,
  OPENARM_HF_LIVE_REAL_SENSE_ROTATION_RPY_DEG,
} from "@/features/teleop/perception/openArmHfLiveParams";
import { buildOperatorPointCloudPoseTransform } from "@/features/teleop/perception/operatorPointCloudPose";
import {
  applyOperatorPointCloudFloorCalibrationToTransform,
  applyOperatorPointCloudFloorCalibrationToWorldPose,
  type OperatorPointCloudFloorCalibration,
} from "@/features/teleop/perception/operatorPointCloudFloorCalibration";
import type { Camera } from "@/shared/types/camera";

const TEST_OPENARM_CAMERA_ALIGNMENT = {
  dotThreshold: 0.999,
  calibrationAnchor: [0.12, -0.18, 0.44] as [number, number, number],
  calibrationCorrectionRad: 0.07,
} as const;

const TEST_OPENARM_CAMERA_CONFIG: Camera = {
  id: "camera-config-openarm-depth",
  name: OPENARM_HF_LIVE_CAMERA_ID,
  parent_joint: "openarm_body_world_joint",
  pose: {
    xyz: [...OPENARM_HF_LIVE_REAL_SENSE_POSITION_M],
    rpy: [...OPENARM_HF_LIVE_CAMERA_RPY_RAD],
  },
  intrinsics: {
    width: 1280,
    height: 720,
    fov_deg: 70,
  },
};

const buildOpenArmCameraConfigQuaternion = () =>
  new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...TEST_OPENARM_CAMERA_CONFIG.pose.rpy, "ZYX"),
  );

describe("openArmHfLiveCameraConfig", () => {
  it("uses a normal URDF Studio camera pose that points downward", () => {
    const cameraConfigQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...TEST_OPENARM_CAMERA_CONFIG.pose.rpy, "ZYX"),
    );
    const cameraForward = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraConfigQuaternion);

    expect(cameraForward.x).toBeCloseTo(0);
    expect(cameraForward.y).toBeCloseTo(0);
    expect(cameraForward.z).toBeCloseTo(-1);
  });

  it("resolves live point-cloud pose from the robot camera config", () => {
    expect(
      resolveOpenArmHfLiveCameraConfigPose(
        [TEST_OPENARM_CAMERA_CONFIG],
        OPENARM_HF_LIVE_CAMERA_ID,
      ),
    ).toEqual({
      position: [...OPENARM_HF_LIVE_REAL_SENSE_POSITION_M],
      rotationRpyDeg: [...OPENARM_HF_LIVE_REAL_SENSE_ROTATION_RPY_DEG],
      scale: 0.001,
      useGravityOrientation: false,
      worldFrame: "urdf_z_up",
    });
  });

  it("aligns the live point cloud optical frame with the yellow studio camera frustum", () => {
    const cameraConfigQuaternion = buildOpenArmCameraConfigQuaternion();
    const cameraDisplayQuaternion = toCameraIconDisplayQuaternion(cameraConfigQuaternion);
    const resolvedPose = resolveOpenArmHfLiveCameraConfigPose(
      [TEST_OPENARM_CAMERA_CONFIG],
      OPENARM_HF_LIVE_CAMERA_ID,
    );
    if (!resolvedPose) {
      throw new Error("Expected OpenArm camera config pose.");
    }
    const pointCloudQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(resolvedPose.rotationRpyDeg[0]),
        THREE.MathUtils.degToRad(resolvedPose.rotationRpyDeg[1]),
        THREE.MathUtils.degToRad(resolvedPose.rotationRpyDeg[2]),
        "XYZ",
      ),
    );

    const yellowFrustumForward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(cameraDisplayQuaternion)
      .normalize();
    const yellowFrustumRight = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(cameraDisplayQuaternion)
      .normalize();
    const yellowFrustumUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(cameraDisplayQuaternion)
      .normalize();
    const pointCloudForward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(pointCloudQuaternion)
      .normalize();
    const pointCloudImageLeft = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(pointCloudQuaternion)
      .normalize();
    const pointCloudImageUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(pointCloudQuaternion)
      .normalize();

    expect(yellowFrustumForward.dot(pointCloudForward)).toBeGreaterThan(
      TEST_OPENARM_CAMERA_ALIGNMENT.dotThreshold,
    );
    expect(yellowFrustumUp.dot(pointCloudImageUp)).toBeGreaterThan(
      TEST_OPENARM_CAMERA_ALIGNMENT.dotThreshold,
    );
    expect(yellowFrustumRight.dot(pointCloudImageLeft)).toBeLessThan(
      -TEST_OPENARM_CAMERA_ALIGNMENT.dotThreshold,
    );
  });

  it("resolves the displayed camera pose from the live point-cloud pose", () => {
    const pointCloudTransform = buildOperatorPointCloudPoseTransform(
      OPENARM_HF_LIVE_REAL_SENSE_POSE,
    );
    const cameraConfigPose =
      resolveOpenArmHfLiveCameraConfigPoseFromPointCloudPose(
        OPENARM_HF_LIVE_REAL_SENSE_POSE,
      );
    const cameraConfigQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...cameraConfigPose.rpy, "ZYX"),
    );

    const pointCloudForward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(pointCloudTransform.quaternion)
      .normalize();
    const pointCloudImageLeft = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(pointCloudTransform.quaternion)
      .normalize();
    const pointCloudImageUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(pointCloudTransform.quaternion)
      .normalize();
    const cameraForward = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(cameraConfigQuaternion)
      .normalize();
    const cameraLeft = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(cameraConfigQuaternion)
      .normalize();
    const cameraUp = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(cameraConfigQuaternion)
      .normalize();

    expect(cameraConfigPose.xyz).toEqual(pointCloudTransform.position);
    expect(cameraForward.dot(pointCloudForward)).toBeGreaterThan(
      TEST_OPENARM_CAMERA_ALIGNMENT.dotThreshold,
    );
    expect(cameraLeft.dot(pointCloudImageLeft)).toBeGreaterThan(
      TEST_OPENARM_CAMERA_ALIGNMENT.dotThreshold,
    );
    expect(cameraUp.dot(pointCloudImageUp)).toBeGreaterThan(
      TEST_OPENARM_CAMERA_ALIGNMENT.dotThreshold,
    );
  });

  it("keeps calibrated camera POV aligned with the calibrated point cloud", () => {
    const calibrationQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      TEST_OPENARM_CAMERA_ALIGNMENT.calibrationCorrectionRad,
    );
    const floorCalibration: OperatorPointCloudFloorCalibration = {
      anchor: TEST_OPENARM_CAMERA_ALIGNMENT.calibrationAnchor,
      correctionAngleRad: TEST_OPENARM_CAMERA_ALIGNMENT.calibrationCorrectionRad,
      normal: [0, 0, 1],
      quaternion: calibrationQuaternion,
    };
    const pointCloudTransform = applyOperatorPointCloudFloorCalibrationToTransform(
      buildOperatorPointCloudPoseTransform(OPENARM_HF_LIVE_REAL_SENSE_POSE),
      floorCalibration,
    );
    const cameraConfigPose =
      resolveOpenArmHfLiveCameraConfigPoseFromPointCloudPose(
        OPENARM_HF_LIVE_REAL_SENSE_POSE,
      );
    const cameraConfigQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...cameraConfigPose.rpy, "ZYX"),
    );
    const calibratedCameraPose = applyOperatorPointCloudFloorCalibrationToWorldPose(
      new THREE.Vector3(...cameraConfigPose.xyz),
      cameraConfigQuaternion,
      floorCalibration,
    );

    const pointCloudForward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(pointCloudTransform.quaternion)
      .normalize();
    const pointCloudImageLeft = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(pointCloudTransform.quaternion)
      .normalize();
    const pointCloudImageUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(pointCloudTransform.quaternion)
      .normalize();
    const cameraForward = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(calibratedCameraPose.quaternion)
      .normalize();
    const cameraLeft = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(calibratedCameraPose.quaternion)
      .normalize();
    const cameraUp = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(calibratedCameraPose.quaternion)
      .normalize();

    expect(calibratedCameraPose.position.toArray()).toEqual(
      pointCloudTransform.position,
    );
    expect(cameraForward.dot(pointCloudForward)).toBeGreaterThan(
      TEST_OPENARM_CAMERA_ALIGNMENT.dotThreshold,
    );
    expect(cameraLeft.dot(pointCloudImageLeft)).toBeGreaterThan(
      TEST_OPENARM_CAMERA_ALIGNMENT.dotThreshold,
    );
    expect(cameraUp.dot(pointCloudImageUp)).toBeGreaterThan(
      TEST_OPENARM_CAMERA_ALIGNMENT.dotThreshold,
    );
  });

  it("ignores unrelated robot camera configs", () => {
    expect(
      resolveOpenArmHfLiveCameraConfigPose(
        [
          {
            ...TEST_OPENARM_CAMERA_CONFIG,
            id: "other-camera",
            name: "other-camera",
          },
        ],
        OPENARM_HF_LIVE_CAMERA_ID,
      ),
    ).toBeNull();
  });
});
