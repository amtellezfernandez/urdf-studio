import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyIntrinsicsToPerspectiveCamera,
  focalLengthPxFromVerticalFovDeg,
  normalizeCameraIntrinsics,
  verticalFovDegFromFocalLengthPx,
} from "./cameraIntrinsics";

describe("cameraIntrinsics", () => {
  it("builds fx/fy/cx/cy from width/height/fov", () => {
    const intrinsics = normalizeCameraIntrinsics({
      width: 640,
      height: 480,
      fov_deg: 70,
    });

    expect(intrinsics.width).toBe(640);
    expect(intrinsics.height).toBe(480);
    expect(intrinsics.cx).toBeCloseTo(320, 6);
    expect(intrinsics.cy).toBeCloseTo(240, 6);
    expect(intrinsics.fx).toBeGreaterThan(0);
    expect(intrinsics.fy).toBeGreaterThan(0);
    expect(intrinsics.fx).toBeCloseTo((intrinsics.fy as number) * (640 / 480), 6);
  });

  it("derives fov from provided focal lengths", () => {
    const fov = 62;
    const fy = focalLengthPxFromVerticalFovDeg(fov, 720);
    const intrinsics = normalizeCameraIntrinsics({
      width: 1280,
      height: 720,
      fov_deg: 10, // should be overridden by fy
      fx: fy * (1280 / 720),
      fy,
      cx: 640,
      cy: 360,
    });

    expect(intrinsics.fov_deg).toBeCloseTo(fov, 6);
    expect(verticalFovDegFromFocalLengthPx(intrinsics.fy as number, intrinsics.height)).toBeCloseTo(
      fov,
      6
    );
  });

  it("applies calibrated projection matrix to perspective camera", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const intrinsics = normalizeCameraIntrinsics({
      width: 640,
      height: 480,
      fov_deg: 70,
      cx: 300,
      cy: 220,
    });

    applyIntrinsicsToPerspectiveCamera(camera, intrinsics, 0.02, 40);

    expect(camera.near).toBeCloseTo(0.02, 8);
    expect(camera.far).toBeCloseTo(40, 8);
    expect(camera.aspect).toBeCloseTo(640 / 480, 8);
    expect(camera.fov).toBeCloseTo(intrinsics.fov_deg, 8);
    // Off-center principal point should produce non-zero projection offsets.
    expect(Math.abs(camera.projectionMatrix.elements[8])).toBeGreaterThan(0);
    expect(Math.abs(camera.projectionMatrix.elements[9])).toBeGreaterThan(0);
  });
});

