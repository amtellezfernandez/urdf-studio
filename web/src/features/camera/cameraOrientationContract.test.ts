import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  evaluateCameraFrontAlignment,
  getWorldForwardFromThreeViewQuaternion,
  getWorldForwardFromUrdfQuaternion,
  toThreeViewQuaternionFromUrdf,
} from "./cameraOrientationContract";
import { CAMERA_ORIENTATION_DOT_EPSILON_STRICT } from "./cameraAutoGenerationParams";

describe("cameraOrientationContract", () => {
  it("maps URDF identity orientation to world +X forward in display frame", () => {
    const urdfQuaternion = new THREE.Quaternion();
    const displayQuaternion = toThreeViewQuaternionFromUrdf(urdfQuaternion);
    const displayForward = getWorldForwardFromThreeViewQuaternion(displayQuaternion);
    expect(displayForward.x).toBeGreaterThan(CAMERA_ORIENTATION_DOT_EPSILON_STRICT);
    expect(Math.abs(displayForward.y)).toBeLessThan(1e-6);
    expect(Math.abs(displayForward.z)).toBeLessThan(1e-6);
  });

  it("keeps URDF and display front vectors aligned for arbitrary rotation", () => {
    const urdfQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.25, -0.41, 0.73, "ZYX")
    );
    const displayQuaternion = toThreeViewQuaternionFromUrdf(urdfQuaternion);
    const urdfForward = getWorldForwardFromUrdfQuaternion(urdfQuaternion);
    const displayForward = getWorldForwardFromThreeViewQuaternion(displayQuaternion);
    expect(displayForward.dot(urdfForward)).toBeGreaterThan(CAMERA_ORIENTATION_DOT_EPSILON_STRICT);
  });

  it("reports alignment via contract helper", () => {
    const urdfQuaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-0.1, 0.35, -0.22, "ZYX")
    );
    const displayQuaternion = toThreeViewQuaternionFromUrdf(urdfQuaternion);
    const report = evaluateCameraFrontAlignment(urdfQuaternion, displayQuaternion);
    expect(report.aligned).toBe(true);
    expect(report.dot).toBeGreaterThan(CAMERA_ORIENTATION_DOT_EPSILON_STRICT);
  });
});
