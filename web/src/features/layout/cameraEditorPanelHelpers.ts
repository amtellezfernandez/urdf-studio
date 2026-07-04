import {
  normalizeCameraIntrinsics,
  scaleIntrinsicsToResolution,
  withIntrinsicsFocalLengths,
  withIntrinsicsFovDeg,
  withIntrinsicsPrincipalPoint,
} from "@/shared/lib/cameraIntrinsics";
import type { CameraTransformDebugReport } from "@/features/camera";
import type { CameraIntrinsics } from "@/shared/types/camera";

export type CameraPoseField = "xyz" | "rpy";
export type CameraPose = {
  xyz: [number, number, number];
  rpy: [number, number, number];
};

export const radToDeg = (radians: number): number => (radians * 180) / Math.PI;

export const degToRad = (degrees: number): number => (degrees * Math.PI) / 180;

export const updatePoseAxis = (
  values: [number, number, number],
  axisIndex: 0 | 1 | 2,
  nextValue: number
): [number, number, number] => {
  const nextValues = [...values] as [number, number, number];
  nextValues[axisIndex] = nextValue;
  return nextValues;
};

export const updateCameraPoseField = ({
  pose,
  field,
  axisIndex,
  nextValue,
}: {
  pose: CameraPose;
  field: CameraPoseField;
  axisIndex: 0 | 1 | 2;
  nextValue: number;
}): CameraPose => {
  return {
    ...pose,
    [field]: updatePoseAxis(pose[field], axisIndex, nextValue),
  };
};

export const buildResolutionIntrinsics = ({
  intrinsics,
  widthPixels,
  heightPixels,
}: {
  intrinsics: CameraIntrinsics;
  widthPixels: number;
  heightPixels: number;
}) => {
  return scaleIntrinsicsToResolution(
    intrinsics,
    Math.round(widthPixels),
    Math.round(heightPixels)
  );
};

export const buildFovIntrinsics = ({
  intrinsics,
  fovDegrees,
}: {
  intrinsics: CameraIntrinsics;
  fovDegrees: number;
}) => withIntrinsicsFovDeg(intrinsics, fovDegrees);

export const buildFocalLengthIntrinsics = ({
  intrinsics,
  axis,
  focalLengthPixels,
}: {
  intrinsics: CameraIntrinsics;
  axis: "fx" | "fy";
  focalLengthPixels: number;
}) => {
  const normalizedIntrinsics = normalizeCameraIntrinsics(intrinsics);
  const safeFocalLengthPixels = Math.max(1e-3, focalLengthPixels);
  const fx =
    axis === "fx" ? safeFocalLengthPixels : normalizedIntrinsics.fx ?? safeFocalLengthPixels;
  const fy =
    axis === "fy" ? safeFocalLengthPixels : normalizedIntrinsics.fy ?? safeFocalLengthPixels;

  return withIntrinsicsFocalLengths(intrinsics, fx, fy);
};

export const buildPrincipalPointIntrinsics = ({
  intrinsics,
  axis,
  principalPointPixels,
}: {
  intrinsics: CameraIntrinsics;
  axis: "cx" | "cy";
  principalPointPixels: number;
}) => {
  const normalizedIntrinsics = normalizeCameraIntrinsics(intrinsics);
  const cx =
    axis === "cx" ? principalPointPixels : normalizedIntrinsics.cx ?? normalizedIntrinsics.width * 0.5;
  const cy =
    axis === "cy" ? principalPointPixels : normalizedIntrinsics.cy ?? normalizedIntrinsics.height * 0.5;

  return withIntrinsicsPrincipalPoint(intrinsics, cx, cy);
};

export const buildCameraDebugSummary = (
  debugReport: CameraTransformDebugReport
): string => {
  const alignmentLabel =
    debugReport.within_tolerance === null
      ? "N/A"
      : debugReport.within_tolerance
        ? "OK"
        : "Mismatch";

  return `Alignment: ${alignmentLabel} · Δpos: ${debugReport.position_delta_m ?? "n/a"} m · Δang: ${debugReport.angle_delta_deg ?? "n/a"} deg`;
};
