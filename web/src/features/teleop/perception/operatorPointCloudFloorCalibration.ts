import * as THREE from "three";
import {
  getOperatorPointCloudPointCount,
  readOperatorPointCloudLocalPoint,
} from "@/features/teleop/perception/operatorPointCloud";
import {
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_MIN_SIZE_M,
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_MIN_AXIS_LENGTH,
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_PADDING_M,
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW,
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MAX_CORRECTION_RAD,
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MAX_SAMPLES,
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MIN_DETERMINANT,
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MIN_FLOOR_SAMPLES,
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_NO_LOWER_BIN_WINDOW,
  OPERATOR_POINT_CLOUD_SURFACE_PLANE_AXIS_Z,
  OPERATOR_POINT_CLOUD_SURFACE_PLANE_FALLBACK_AXIS,
  OPERATOR_POINT_CLOUD_SURFACE_PLANE_UP,
  OPERATOR_POINT_CLOUD_SURFACE_YAW_COVARIANCE_CROSS_FACTOR,
  OPERATOR_POINT_CLOUD_SURFACE_YAW_FALLBACK_RAD,
  OPERATOR_POINT_CLOUD_SURFACE_YAW_HALF_ANGLE_FACTOR,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorPointCloudPoseTransform } from "@/features/teleop/perception/operatorPointCloudPose";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";

export type OperatorPointCloudWorldSample = {
  binKey: number;
  x: number;
  y: number;
  z: number;
};

export type OperatorPointCloudFloorCalibration = {
  anchor: [number, number, number];
  quaternion: THREE.Quaternion;
  correctionAngleRad: number;
  normal: [number, number, number];
};

export type OperatorPointCloudSurfacePlane = {
  center: [number, number, number];
  normal: [number, number, number];
  quaternion: THREE.Quaternion;
  size: [number, number];
  sampleCount: number;
  surfacePoints?: Array<[number, number, number]>;
  yawRad: number;
};

export type OperatorPointCloudSurfaceCalibrationResult = {
  calibration: OperatorPointCloudFloorCalibration;
  plane: OperatorPointCloudSurfacePlane;
};

export type OperatorPointCloudFloorCalibrationByCameraId = Record<
  string,
  OperatorPointCloudFloorCalibration | null
>;

type OperatorPointCloudFloorBin = {
  binKey: number;
  count: number;
};

const OPERATOR_POINT_CLOUD_SURFACE_PLANE_UP_VECTOR = new THREE.Vector3(
  ...OPERATOR_POINT_CLOUD_SURFACE_PLANE_UP,
);
const OPERATOR_POINT_CLOUD_SURFACE_PLANE_FALLBACK_AXIS_VECTOR = new THREE.Vector3(
  ...OPERATOR_POINT_CLOUD_SURFACE_PLANE_FALLBACK_AXIS,
);

const collectDenseSurfaceBins = (
  samples: readonly OperatorPointCloudWorldSample[],
): OperatorPointCloudFloorBin[] => {
  const bins = new Map<number, OperatorPointCloudFloorBin>();
  for (const sample of samples) {
    const bin = bins.get(sample.binKey);
    if (bin) {
      bin.count += 1;
    } else {
      bins.set(sample.binKey, { binKey: sample.binKey, count: 1 });
    }
  }

  return [...bins.values()].filter(
    (bin) => bin.count >= OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MIN_FLOOR_SAMPLES,
  );
};

export const collectOperatorPointCloudWorldSamples = (
  frame: OperatorPointCloudFrame,
  poseTransform: OperatorPointCloudPoseTransform | null,
  maxSamples = OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MAX_SAMPLES,
): OperatorPointCloudWorldSample[] => {
  const pointCount = getOperatorPointCloudPointCount(frame);
  if (pointCount <= 0) return [];

  const stride = Math.max(1, Math.ceil(pointCount / maxSamples));
  const localPoint = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  const posePosition = poseTransform
    ? new THREE.Vector3(...poseTransform.position)
    : null;
  const samples: OperatorPointCloudWorldSample[] = [];

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += stride) {
    const point = readOperatorPointCloudLocalPoint(frame, pointIndex, localPoint);
    if (!point) continue;
    if (poseTransform) {
      worldPoint
        .copy(point)
        .multiplyScalar(poseTransform.pointScale)
        .applyQuaternion(poseTransform.quaternion)
        .add(posePosition);
    } else {
      worldPoint.copy(point);
    }
    if (!Number.isFinite(worldPoint.z)) continue;
    samples.push({
      binKey: Math.round(
        worldPoint.z / OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
      ),
      x: worldPoint.x,
      y: worldPoint.y,
      z: worldPoint.z,
    });
  }

  return samples;
};

const resolveLowestDenseFloorBin = (
  samples: readonly OperatorPointCloudWorldSample[],
): OperatorPointCloudFloorBin | null => {
  return (
    collectDenseSurfaceBins(samples)
      .sort((left, right) => left.binKey - right.binKey)[0] ?? null
  );
};

const resolveDominantDenseSurfaceBin = (
  samples: readonly OperatorPointCloudWorldSample[],
): OperatorPointCloudFloorBin | null => {
  return (
    collectDenseSurfaceBins(samples)
      .sort(
        (left, right) =>
          right.count - left.count || left.binKey - right.binKey,
      )[0] ?? null
  );
};

const collectSurfaceSamplesForBin = (
  samples: readonly OperatorPointCloudWorldSample[],
  surfaceBin: OperatorPointCloudFloorBin,
  lowerBinWindow = OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_NO_LOWER_BIN_WINDOW,
): OperatorPointCloudWorldSample[] => {
  const minSurfaceBinKey = surfaceBin.binKey - lowerBinWindow;
  const maxSurfaceBinKey =
    surfaceBin.binKey + OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW;
  return samples.filter(
    (sample) =>
      sample.binKey >= minSurfaceBinKey && sample.binKey <= maxSurfaceBinKey,
  );
};

const fitFloorPlaneNormal = (
  samples: readonly OperatorPointCloudWorldSample[],
): THREE.Vector3 | null => {
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let sumXx = 0;
  let sumYy = 0;
  let sumXy = 0;
  let sumXz = 0;
  let sumYz = 0;

  for (const sample of samples) {
    sumX += sample.x;
    sumY += sample.y;
    sumZ += sample.z;
    sumXx += sample.x * sample.x;
    sumYy += sample.y * sample.y;
    sumXy += sample.x * sample.y;
    sumXz += sample.x * sample.z;
    sumYz += sample.y * sample.z;
  }

  const count = samples.length;
  const determinant =
    sumXx * (sumYy * count - sumY * sumY) -
    sumXy * (sumXy * count - sumY * sumX) +
    sumX * (sumXy * sumY - sumYy * sumX);
  if (Math.abs(determinant) < OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MIN_DETERMINANT) {
    return null;
  }

  const slopeX =
    (sumXz * (sumYy * count - sumY * sumY) -
      sumXy * (sumYz * count - sumY * sumZ) +
      sumX * (sumYz * sumY - sumYy * sumZ)) /
    determinant;
  const slopeY =
    (sumXx * (sumYz * count - sumY * sumZ) -
      sumXz * (sumXy * count - sumY * sumX) +
      sumX * (sumXy * sumZ - sumYz * sumX)) /
    determinant;

  const normal = new THREE.Vector3(-slopeX, -slopeY, 1).normalize();
  return normal.z >= 0 ? normal : normal.multiplyScalar(-1);
};

const resolveSurfaceFootprintYawRad = (
  samples: readonly OperatorPointCloudWorldSample[],
  center: THREE.Vector3,
): number => {
  let covarianceXx = 0;
  let covarianceYy = 0;
  let covarianceXy = 0;
  for (const sample of samples) {
    const deltaX = sample.x - center.x;
    const deltaY = sample.y - center.y;
    covarianceXx += deltaX * deltaX;
    covarianceYy += deltaY * deltaY;
    covarianceXy += deltaX * deltaY;
  }

  const yawRad =
    OPERATOR_POINT_CLOUD_SURFACE_YAW_HALF_ANGLE_FACTOR *
    Math.atan2(
      OPERATOR_POINT_CLOUD_SURFACE_YAW_COVARIANCE_CROSS_FACTOR * covarianceXy,
      covarianceXx - covarianceYy,
    );
  return Number.isFinite(yawRad)
    ? yawRad
    : OPERATOR_POINT_CLOUD_SURFACE_YAW_FALLBACK_RAD;
};

const resolveOperatorPointCloudSurfaceCalibrationResult = (
  surfaceSamples: readonly OperatorPointCloudWorldSample[],
): OperatorPointCloudSurfaceCalibrationResult | null => {
  if (
    surfaceSamples.length < OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MIN_FLOOR_SAMPLES
  ) {
    return null;
  }

  const normal = fitFloorPlaneNormal(surfaceSamples);
  if (!normal) return null;

  const correctionAngleRad = normal.angleTo(
    OPERATOR_POINT_CLOUD_SURFACE_PLANE_UP_VECTOR,
  );
  if (correctionAngleRad > OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MAX_CORRECTION_RAD) {
    return null;
  }

  const anchor = surfaceSamples.reduce(
    (accumulator, sample) =>
      accumulator.add(new THREE.Vector3(sample.x, sample.y, sample.z)),
    new THREE.Vector3(),
  ).divideScalar(surfaceSamples.length);
  const yawRad = resolveSurfaceFootprintYawRad(surfaceSamples, anchor);

  const planeAxisU = new THREE.Vector3(
    Math.cos(yawRad),
    Math.sin(yawRad),
    OPERATOR_POINT_CLOUD_SURFACE_PLANE_AXIS_Z,
  ).projectOnPlane(normal);
  if (
    planeAxisU.length() <
    OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_MIN_AXIS_LENGTH
  ) {
    planeAxisU.copy(OPERATOR_POINT_CLOUD_SURFACE_PLANE_FALLBACK_AXIS_VECTOR)
      .projectOnPlane(normal);
  }
  planeAxisU.normalize();
  const planeAxisV = new THREE.Vector3().crossVectors(normal, planeAxisU).normalize();
  const planeQuaternion = new THREE.Quaternion()
    .setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(planeAxisU, planeAxisV, normal),
    )
    .normalize();
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const sample of surfaceSamples) {
    const centered = new THREE.Vector3(sample.x, sample.y, sample.z).sub(anchor);
    const u = centered.dot(planeAxisU);
    const v = centered.dot(planeAxisV);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  const planeSizeU = Math.max(
    OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_MIN_SIZE_M,
    maxU - minU + OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_PADDING_M,
  );
  const planeSizeV = Math.max(
    OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_MIN_SIZE_M,
    maxV - minV + OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_PADDING_M,
  );

  return {
    calibration: {
      anchor: [anchor.x, anchor.y, anchor.z],
      quaternion: new THREE.Quaternion()
        .setFromUnitVectors(normal, OPERATOR_POINT_CLOUD_SURFACE_PLANE_UP_VECTOR)
        .normalize(),
      correctionAngleRad,
      normal: [normal.x, normal.y, normal.z],
    },
    plane: {
      center: [anchor.x, anchor.y, anchor.z],
      normal: [normal.x, normal.y, normal.z],
      quaternion: planeQuaternion,
      size: [planeSizeU, planeSizeV],
      sampleCount: surfaceSamples.length,
      surfacePoints: surfaceSamples.map((sample) => [
        sample.x,
        sample.y,
        sample.z,
      ]),
      yawRad,
    },
  };
};

export const resolveOperatorPointCloudFloorCalibration = (
  samples: readonly OperatorPointCloudWorldSample[],
): OperatorPointCloudFloorCalibration | null => {
  const floorBin = resolveLowestDenseFloorBin(samples);
  if (!floorBin) return null;

  return resolveOperatorPointCloudSurfaceCalibrationResult(
    collectSurfaceSamplesForBin(samples, floorBin),
  )?.calibration ?? null;
};

export const resolveOperatorPointCloudDominantSurfaceCalibrationResult = (
  samples: readonly OperatorPointCloudWorldSample[],
): OperatorPointCloudSurfaceCalibrationResult | null => {
  const surfaceBin = resolveDominantDenseSurfaceBin(samples);
  if (!surfaceBin) return null;

  return resolveOperatorPointCloudSurfaceCalibrationResult(
    collectSurfaceSamplesForBin(
      samples,
      surfaceBin,
      OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW,
    ),
  );
};

export const applyOperatorPointCloudFloorCalibrationToTransform = (
  poseTransform: OperatorPointCloudPoseTransform,
  calibration: OperatorPointCloudFloorCalibration | null,
): OperatorPointCloudPoseTransform => {
  if (!calibration) return poseTransform;

  const anchor = new THREE.Vector3(...calibration.anchor);
  const position = new THREE.Vector3(...poseTransform.position)
    .sub(anchor)
    .applyQuaternion(calibration.quaternion)
    .add(anchor);

  return {
    position: [position.x, position.y, position.z],
    quaternion: calibration.quaternion.clone().multiply(poseTransform.quaternion).normalize(),
    pointScale: poseTransform.pointScale,
  };
};

export const applyOperatorPointCloudFloorCalibrationToWorldPose = (
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  calibration: OperatorPointCloudFloorCalibration | null,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } => {
  if (!calibration) {
    return {
      position: position.clone(),
      quaternion: quaternion.clone(),
    };
  }

  const anchor = new THREE.Vector3(...calibration.anchor);
  return {
    position: position
      .clone()
      .sub(anchor)
      .applyQuaternion(calibration.quaternion)
      .add(anchor),
    quaternion: calibration.quaternion.clone().multiply(quaternion).normalize(),
  };
};

export const applyOperatorPointCloudFloorCalibrationToSample = (
  sample: OperatorPointCloudWorldSample,
  calibration: OperatorPointCloudFloorCalibration | null,
): OperatorPointCloudWorldSample => {
  if (!calibration) return sample;

  const anchor = new THREE.Vector3(...calibration.anchor);
  const point = new THREE.Vector3(sample.x, sample.y, sample.z)
    .sub(anchor)
    .applyQuaternion(calibration.quaternion)
    .add(anchor);

  return {
    ...sample,
    binKey: Math.round(
      point.z / OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
    ),
    x: point.x,
    y: point.y,
    z: point.z,
  };
};

export const applyOperatorPointCloudFloorCalibrationToPlane = (
  plane: OperatorPointCloudSurfacePlane,
  calibration: OperatorPointCloudFloorCalibration | null,
): OperatorPointCloudSurfacePlane => {
  if (!calibration) return plane;

  const anchor = new THREE.Vector3(...calibration.anchor);
  const center = new THREE.Vector3(...plane.center)
    .sub(anchor)
    .applyQuaternion(calibration.quaternion)
    .add(anchor);
  const normal = new THREE.Vector3(...plane.normal)
    .applyQuaternion(calibration.quaternion)
    .normalize();
  const surfacePoints = plane.surfacePoints?.map((point) => {
    const transformed = new THREE.Vector3(...point)
      .sub(anchor)
      .applyQuaternion(calibration.quaternion)
      .add(anchor);
    return [transformed.x, transformed.y, transformed.z] as [number, number, number];
  });

  return {
    ...plane,
    center: [center.x, center.y, center.z],
    normal: [normal.x, normal.y, normal.z],
    quaternion: calibration.quaternion.clone().multiply(plane.quaternion).normalize(),
    surfacePoints,
    yawRad: plane.yawRad,
  };
};
