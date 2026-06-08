import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyUrdfCameraToThreeViewQuaternion,
  getUrdfCameraToThreeViewEuler,
} from "@/features/camera/cameraFrameTransform";

describe("cameraFrameTransform", () => {
  it("maps Three.js camera forward (-Z) to robotics forward (+X) for identity URDF pose", () => {
    const finalQuat = applyUrdfCameraToThreeViewQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(finalQuat).normalize();

    expect(forward.x).toBeGreaterThan(0.999);
    expect(Math.abs(forward.y)).toBeLessThan(1e-6);
    expect(Math.abs(forward.z)).toBeLessThan(1e-6);
  });

  it("keeps icon rotation helper aligned with quaternion conversion", () => {
    const [rx, ry, rz] = getUrdfCameraToThreeViewEuler();
    const iconQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "XYZ"));
    const viewQuat = applyUrdfCameraToThreeViewQuaternion(new THREE.Quaternion());
    const angularDiff = iconQuat.angleTo(viewQuat);

    expect(angularDiff).toBeLessThan(1e-6);
  });
});

