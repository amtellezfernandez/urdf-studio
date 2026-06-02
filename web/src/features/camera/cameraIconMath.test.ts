import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  createCameraIconFrustumGeometry,
  getCameraIconFrustumForwardLocal,
  getCameraIconLensAxisDirectionLocal,
  getCameraIconLensCenterDirectionLocal,
  toLeveledCameraIconDisplayQuaternion,
  toLeveledFrustumLocalQuaternion,
  toCameraIconDisplayQuaternion,
} from "./cameraIconMath";
import { CAMERA_ICON_FRUSTUM_FAR_M, CAMERA_ICON_FRUSTUM_NEAR_M } from "./cameraIconParams";
import { CAMERA_ORIENTATION_DOT_EPSILON_STRICT } from "./cameraAutoGenerationParams";

describe("cameraIconMath", () => {
  const WORLD_UP_AXIS = new THREE.Vector3(0, 0, 1);
  const THREE_VIEW_FORWARD = new THREE.Vector3(0, 0, -1);
  const THREE_VIEW_UP = new THREE.Vector3(0, 1, 0);
  const FORWARD_ALIGNMENT_THRESHOLD = 0.999;
  const UP_ALIGNMENT_THRESHOLD = 0.98;
  const HORIZON_TEST_EULER: [number, number, number] = [0.3, 0.1, 0.7];

  it("maps Three camera forward (-Z) to robotics forward (+X) for identity URDF pose", () => {
    const displayQuat = toCameraIconDisplayQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(displayQuat).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(displayQuat).normalize();

    expect(forward.x).toBeGreaterThan(0.999);
    expect(Math.abs(forward.y)).toBeLessThan(1e-6);
    expect(Math.abs(forward.z)).toBeLessThan(1e-6);
    expect(Math.abs(up.x)).toBeLessThan(1e-6);
    expect(Math.abs(up.y)).toBeLessThan(1e-6);
    expect(up.z).toBeGreaterThan(0.999);
  });

  it("creates frustum geometry with configured near/far depths along -Z", () => {
    const geometry = createCameraIconFrustumGeometry({
      width: 640,
      height: 480,
      fov_deg: 78,
    });
    const positionAttr = geometry.getAttribute("position");
    if (!positionAttr) {
      throw new Error("Frustum geometry position attribute missing");
    }
    const positions = positionAttr.array as Float32Array;

    expect(positions[2]).toBeCloseTo(-CAMERA_ICON_FRUSTUM_NEAR_M, 6);
    expect(positions[14]).toBeCloseTo(-CAMERA_ICON_FRUSTUM_FAR_M, 6);
  });

  it("uses principal point offsets for asymmetric camera projection bounds", () => {
    const intrinsics = {
      width: 640,
      height: 480,
      fx: 520,
      fy: 510,
      cx: 403,
      cy: 181,
      fov_deg: 78,
    } as const;
    const geometry = createCameraIconFrustumGeometry(intrinsics);
    const positionAttr = geometry.getAttribute("position");
    if (!positionAttr) {
      throw new Error("Frustum geometry position attribute missing");
    }
    const positions = positionAttr.array as Float32Array;

    const nearLeft = positions[0];
    const nearTop = positions[1];
    const nearRight = positions[3];
    const nearBottom = positions[7];
    const farLeft = positions[12];
    const farRight = positions[15];

    expect(nearLeft).toBeCloseTo(
      (-intrinsics.cx * CAMERA_ICON_FRUSTUM_NEAR_M) / intrinsics.fx,
    );
    expect(nearRight).toBeCloseTo(
      ((intrinsics.width - intrinsics.cx) * CAMERA_ICON_FRUSTUM_NEAR_M) /
        intrinsics.fx,
    );
    expect(nearTop).toBeCloseTo(
      (intrinsics.cy * CAMERA_ICON_FRUSTUM_NEAR_M) / intrinsics.fy,
    );
    expect(nearBottom).toBeCloseTo(
      (-(intrinsics.height - intrinsics.cy) * CAMERA_ICON_FRUSTUM_NEAR_M) /
        intrinsics.fy,
    );
    expect(Math.abs(farLeft)).toBeGreaterThan(Math.abs(nearLeft));
    expect(farRight).toBeGreaterThan(nearRight);
  });

  it("keeps perspective frustum expansion from near plane to far plane", () => {
    const geometry = createCameraIconFrustumGeometry({
      width: 640,
      height: 480,
      fov_deg: 78,
    });
    const positionAttr = geometry.getAttribute("position");
    if (!positionAttr) {
      throw new Error("Frustum geometry position attribute missing");
    }
    const positions = positionAttr.array as Float32Array;
    const nearWidth = Math.abs(positions[3] - positions[0]);
    const nearHeight = Math.abs(positions[1] - positions[10]);
    const farWidth = Math.abs(positions[15] - positions[12]);
    const farHeight = Math.abs(positions[13] - positions[22]);

    expect(farWidth).toBeGreaterThan(nearWidth);
    expect(farHeight).toBeGreaterThan(nearHeight);
  });

  it("keeps black lens and yellow frustum front aligned in icon local frame", () => {
    const frustumForward = getCameraIconFrustumForwardLocal();
    const lensCenterDirection = getCameraIconLensCenterDirectionLocal();
    const lensAxisDirection = getCameraIconLensAxisDirectionLocal();

    expect(frustumForward.dot(lensCenterDirection)).toBeGreaterThan(
      CAMERA_ORIENTATION_DOT_EPSILON_STRICT
    );
    expect(Math.abs(frustumForward.dot(lensAxisDirection))).toBeGreaterThan(
      CAMERA_ORIENTATION_DOT_EPSILON_STRICT
    );
  });

  it("levels frustum roll while preserving forward direction", () => {
    const urdfQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...HORIZON_TEST_EULER, "ZYX")
    );
    const baseDisplay = toCameraIconDisplayQuaternion(urdfQuaternion);
    const leveledDisplay = toLeveledCameraIconDisplayQuaternion(urdfQuaternion);
    const baseForward = THREE_VIEW_FORWARD.clone().applyQuaternion(baseDisplay).normalize();
    const leveledForward = THREE_VIEW_FORWARD.clone().applyQuaternion(leveledDisplay).normalize();
    expect(baseForward.dot(leveledForward)).toBeGreaterThan(FORWARD_ALIGNMENT_THRESHOLD);

    const leveledUp = THREE_VIEW_UP.clone().applyQuaternion(leveledDisplay).normalize();
    expect(leveledUp.dot(WORLD_UP_AXIS)).toBeGreaterThan(UP_ALIGNMENT_THRESHOLD);
  });

  it("computes frustum-local leveling quaternion", () => {
    const urdfQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...HORIZON_TEST_EULER, "ZYX")
    );
    const baseDisplay = toCameraIconDisplayQuaternion(urdfQuaternion);
    const frustumLocal = toLeveledFrustumLocalQuaternion(urdfQuaternion);
    const leveledFromLocal = baseDisplay.clone().multiply(frustumLocal).normalize();
    const leveledDirect = toLeveledCameraIconDisplayQuaternion(urdfQuaternion);
    expect(leveledFromLocal.dot(leveledDirect)).toBeGreaterThan(
      CAMERA_ORIENTATION_DOT_EPSILON_STRICT
    );
  });
});
