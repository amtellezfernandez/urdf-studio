import { describe, expect, it } from "vitest";

import {
  buildCameraDebugSummary,
  buildFocalLengthIntrinsics,
  buildFovIntrinsics,
  buildPrincipalPointIntrinsics,
  buildResolutionIntrinsics,
  degToRad,
  radToDeg,
  updateCameraPoseField,
  updatePoseAxis,
} from "@/features/layout/cameraEditorPanelHelpers";

describe("cameraEditorPanelHelpers", () => {
  it("converts between radians and degrees", () => {
    expect(radToDeg(Math.PI)).toBe(180);
    expect(degToRad(180)).toBeCloseTo(Math.PI);
  });

  it("updates a pose axis tuple", () => {
    expect(updatePoseAxis([1, 2, 3], 1, 9)).toEqual([1, 9, 3]);
  });

  it("updates a camera pose field immutably", () => {
    const pose = { xyz: [1, 2, 3] as [number, number, number], rpy: [4, 5, 6] as [number, number, number] };
    expect(
      updateCameraPoseField({
        pose,
        field: "xyz",
        axisIndex: 2,
        nextValue: 8,
      })
    ).toEqual({
      xyz: [1, 2, 8],
      rpy: [4, 5, 6],
    });
  });

  it("builds rounded resolution intrinsics", () => {
    const result = buildResolutionIntrinsics({
      intrinsics: { width: 640, height: 480, fov_deg: 70, fx: 320, fy: 320, cx: 320, cy: 240 },
      widthPixels: 801.2,
      heightPixels: 601.8,
    });

    expect(result.width).toBe(801);
    expect(result.height).toBe(602);
  });

  it("builds FOV intrinsics", () => {
    const result = buildFovIntrinsics({
      intrinsics: { width: 640, height: 480, fov_deg: 70, fx: 320, fy: 320, cx: 320, cy: 240 },
      fovDegrees: 60,
    });

    expect(result.fov_deg).toBeCloseTo(60);
  });

  it("builds focal length intrinsics with safe minimum", () => {
    const result = buildFocalLengthIntrinsics({
      intrinsics: { width: 640, height: 480, fov_deg: 70, fx: 320, fy: 300, cx: 320, cy: 240 },
      axis: "fy",
      focalLengthPixels: 0,
    });

    expect(result.fx).toBe(320);
    expect(result.fy).toBe(1e-3);
  });

  it("builds principal point intrinsics using defaults for the untouched axis", () => {
    const result = buildPrincipalPointIntrinsics({
      intrinsics: { width: 640, height: 480, fov_deg: 70, fx: 320, fy: 300, cx: undefined, cy: undefined },
      axis: "cx",
      principalPointPixels: 100,
    });

    expect(result.cx).toBe(100);
    expect(result.cy).toBe(240);
  });

  it("formats the camera debug summary", () => {
    expect(
      buildCameraDebugSummary({
        within_tolerance: false,
        position_delta_m: 0.1,
        angle_delta_deg: 2,
      } as never)
    ).toBe("Alignment: Mismatch · Δpos: 0.1 m · Δang: 2 deg");
  });
});
