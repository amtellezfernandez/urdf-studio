import type { PerspectiveCamera } from "three";
import type { CameraDistortion, CameraIntrinsics } from "@/shared/types/camera";
import { clampNumber, toFiniteNumberOrFallback } from "@/shared/lib/numeric";

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;
const DEFAULT_FOV_DEG = 70;
const MIN_NEAR = 0.001;
const MIN_FAR_DELTA = 0.01;

const isFinitePositive = (value: number | undefined): value is number =>
  Number.isFinite(value) && value > 0;

const clampDimension = (value: number | undefined, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value as number));
};

const clampFov = (value: number | undefined, fallback = DEFAULT_FOV_DEG) => {
  if (!Number.isFinite(value)) return fallback;
  return clampNumber(value as number, 1, 179);
};

const normalizeDistortion = (
  distortion: CameraDistortion | undefined
): CameraDistortion | undefined => {
  if (!distortion) return undefined;
  const normalized: CameraDistortion = {};
  if (Number.isFinite(distortion.k1)) normalized.k1 = distortion.k1;
  if (Number.isFinite(distortion.k2)) normalized.k2 = distortion.k2;
  if (Number.isFinite(distortion.p1)) normalized.p1 = distortion.p1;
  if (Number.isFinite(distortion.p2)) normalized.p2 = distortion.p2;
  if (Number.isFinite(distortion.k3)) normalized.k3 = distortion.k3;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const focalLengthPxFromVerticalFovDeg = (fovDeg: number, heightPx: number) => {
  const safeFov = clampFov(fovDeg);
  const safeHeight = Math.max(1, heightPx);
  const halfFovRad = (safeFov * Math.PI) / 360;
  return safeHeight / (2 * Math.tan(halfFovRad));
};

export const verticalFovDegFromFocalLengthPx = (fyPx: number, heightPx: number) => {
  const safeFy = Math.max(1e-6, fyPx);
  const safeHeight = Math.max(1, heightPx);
  const halfFovRad = Math.atan(safeHeight / (2 * safeFy));
  return clampFov((halfFovRad * 360) / Math.PI);
};

export const normalizeCameraIntrinsics = (intrinsics: CameraIntrinsics): CameraIntrinsics => {
  const width = clampDimension(intrinsics.width, DEFAULT_WIDTH);
  const height = clampDimension(intrinsics.height, DEFAULT_HEIGHT);
  const fallbackFov = clampFov(intrinsics.fov_deg, DEFAULT_FOV_DEG);

  const hasFx = isFinitePositive(intrinsics.fx);
  const hasFy = isFinitePositive(intrinsics.fy);

  let fx = hasFx ? intrinsics.fx : undefined;
  let fy = hasFy ? intrinsics.fy : undefined;

  if (!fx && fy) {
    fx = fy * (width / height);
  }
  if (!fy && fx) {
    fy = fx * (height / width);
  }

  if (!fx || !fy) {
    fy = focalLengthPxFromVerticalFovDeg(fallbackFov, height);
    fx = fy * (width / height);
  }

  const cx = toFiniteNumberOrFallback(intrinsics.cx, width * 0.5);
  const cy = toFiniteNumberOrFallback(intrinsics.cy, height * 0.5);
  const fov_deg = verticalFovDegFromFocalLengthPx(fy, height);

  return {
    width,
    height,
    fov_deg,
    fx,
    fy,
    cx,
    cy,
    distortion: normalizeDistortion(intrinsics.distortion),
  };
};

export const scaleIntrinsicsToResolution = (
  intrinsics: CameraIntrinsics,
  width: number,
  height: number
): CameraIntrinsics => {
  const normalized = normalizeCameraIntrinsics(intrinsics);
  const nextWidth = clampDimension(width, normalized.width);
  const nextHeight = clampDimension(height, normalized.height);

  const sx = nextWidth / normalized.width;
  const sy = nextHeight / normalized.height;

  return normalizeCameraIntrinsics({
    ...normalized,
    width: nextWidth,
    height: nextHeight,
    fx: normalized.fx ? normalized.fx * sx : undefined,
    fy: normalized.fy ? normalized.fy * sy : undefined,
    cx: normalized.cx !== undefined ? normalized.cx * sx : undefined,
    cy: normalized.cy !== undefined ? normalized.cy * sy : undefined,
  });
};

export const withIntrinsicsFovDeg = (
  intrinsics: CameraIntrinsics,
  fovDeg: number
): CameraIntrinsics => {
  const normalized = normalizeCameraIntrinsics(intrinsics);
  const safeFov = clampFov(fovDeg, normalized.fov_deg);
  const fy = focalLengthPxFromVerticalFovDeg(safeFov, normalized.height);
  const fx = fy * (normalized.width / normalized.height);
  return normalizeCameraIntrinsics({
    ...normalized,
    fov_deg: safeFov,
    fx,
    fy,
  });
};

export const withIntrinsicsFocalLengths = (
  intrinsics: CameraIntrinsics,
  fx: number,
  fy: number
): CameraIntrinsics => {
  const normalized = normalizeCameraIntrinsics(intrinsics);
  return normalizeCameraIntrinsics({
    ...normalized,
    fx,
    fy,
  });
};

export const withIntrinsicsPrincipalPoint = (
  intrinsics: CameraIntrinsics,
  cx: number,
  cy: number
): CameraIntrinsics =>
  normalizeCameraIntrinsics({
    ...normalizeCameraIntrinsics(intrinsics),
    cx,
    cy,
  });

export const applyIntrinsicsToPerspectiveCamera = (
  camera: PerspectiveCamera,
  intrinsics: CameraIntrinsics,
  near: number,
  far: number
) => {
  const normalized = normalizeCameraIntrinsics(intrinsics);
  const safeNear = Math.max(MIN_NEAR, near);
  const safeFar = Math.max(safeNear + MIN_FAR_DELTA, far);

  const fx = normalized.fx ?? focalLengthPxFromVerticalFovDeg(normalized.fov_deg, normalized.height);
  const fy = normalized.fy ?? fx * (normalized.height / normalized.width);
  const cx = normalized.cx ?? normalized.width * 0.5;
  const cy = normalized.cy ?? normalized.height * 0.5;

  const left = (-cx * safeNear) / fx;
  const right = ((normalized.width - cx) * safeNear) / fx;
  const top = (cy * safeNear) / fy;
  const bottom = (-(normalized.height - cy) * safeNear) / fy;

  camera.near = safeNear;
  camera.far = safeFar;
  camera.aspect = normalized.width / normalized.height;
  camera.fov = normalized.fov_deg;
  camera.projectionMatrix.makePerspective(left, right, top, bottom, safeNear, safeFar);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return normalized;
};
