import * as THREE from "three";

import {
  getOperatorPointCloudPointCount,
  readOperatorPointCloudLocalPoint,
} from "@/features/teleop/perception/operatorPointCloud";
import {
  applyOperatorPointCloudFloorCalibrationToSample,
  type OperatorPointCloudFloorCalibrationByCameraId,
  type OperatorPointCloudWorldSample,
} from "@/features/teleop/perception/operatorPointCloudFloorCalibration";
import { buildOperatorPointCloudPoseTransform } from "@/features/teleop/perception/operatorPointCloudPose";
import {
  OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_MIN_AXIS_LENGTH,
  OPERATOR_POINT_CLOUD_COLOR_COMPONENTS,
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW,
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
  OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX,
  OPERATOR_POINT_CLOUD_SCENE_MESH_DEFAULT_COLOR,
  OPERATOR_POINT_CLOUD_SCENE_MESH_FOOTPRINT_PADDING_M,
  OPERATOR_POINT_CLOUD_SCENE_MESH_HALF_EXTENT_FACTOR,
  OPERATOR_POINT_CLOUD_SCENE_MESH_LABEL_INDEX_OFFSET,
  OPERATOR_POINT_CLOUD_SCENE_MESH_MAX_SAMPLES_PER_FRAME,
  OPERATOR_POINT_CLOUD_SCENE_MESH_MAX_SURFACES,
  OPERATOR_POINT_CLOUD_SCENE_MESH_MIN_AREA_M2,
  OPERATOR_POINT_CLOUD_SCENE_MESH_MIN_SURFACE_SAMPLES,
  OPERATOR_POINT_CLOUD_SCENE_MESH_THICKNESS_M,
  OPERATOR_POINT_CLOUD_SURFACE_YAW_COVARIANCE_CROSS_FACTOR,
  OPERATOR_POINT_CLOUD_SURFACE_YAW_FALLBACK_RAD,
  OPERATOR_POINT_CLOUD_SURFACE_YAW_HALF_ANGLE_FACTOR,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";

export type OperatorPointCloudColoredWorldSample =
  OperatorPointCloudWorldSample & {
    red: number;
    green: number;
    blue: number;
  };

export type OperatorPointCloudSceneMesh = {
  label: string;
  kind: "floor" | "surface";
  position: [number, number, number];
  rotationRpyRad: [number, number, number];
  size: [number, number, number];
  color: string;
  sampleCount: number;
};

export type OperatorPointCloudSceneMeshCalibrationPlane = {
  center: [number, number, number];
  yawRad: number;
  size?: [number, number];
  surfacePoints?: Array<[number, number, number]>;
};

type OperatorPointCloudSceneMeshBin = {
  binKey: number;
  count: number;
};

type OperatorPointCloudSceneMeshFitOptions = {
  colorSamples?: readonly OperatorPointCloudColoredWorldSample[];
  fallbackCenter?: [number, number, number];
  fallbackSize?: [number, number];
  surfaceZ?: number;
  yawRad?: number;
};

const POINT_CLOUD_COLOR_COMPONENT_INDEX = {
  red: 0,
  green: 1,
  blue: 2,
} as const;

const normalizePointCloudColorComponent = (component: number): number => {
  if (!Number.isFinite(component)) {
    return OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX;
  }
  const scaledComponent =
    component <= 1
      ? component * OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX
      : component;
  return Math.min(
    OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX,
    Math.max(0, Math.round(scaledComponent)),
  );
};

const readOperatorPointCloudColor = (
  frame: OperatorPointCloudFrame,
  pointIndex: number,
): Pick<OperatorPointCloudColoredWorldSample, "red" | "green" | "blue"> => {
  if (frame.colorsRgbFlat) {
    const offset = pointIndex * OPERATOR_POINT_CLOUD_COLOR_COMPONENTS;
    const blueOffset = offset + POINT_CLOUD_COLOR_COMPONENT_INDEX.blue;
    if (blueOffset < frame.colorsRgbFlat.length) {
      return {
        red: normalizePointCloudColorComponent(
          frame.colorsRgbFlat[offset + POINT_CLOUD_COLOR_COMPONENT_INDEX.red],
        ),
        green: normalizePointCloudColorComponent(
          frame.colorsRgbFlat[offset + POINT_CLOUD_COLOR_COMPONENT_INDEX.green],
        ),
        blue: normalizePointCloudColorComponent(frame.colorsRgbFlat[blueOffset]),
      };
    }
  }

  const color = frame.colorsRgb[pointIndex];
  if (!color) {
    return {
      red: OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX,
      green: OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX,
      blue: OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX,
    };
  }

  return {
    red: normalizePointCloudColorComponent(
      color[POINT_CLOUD_COLOR_COMPONENT_INDEX.red],
    ),
    green: normalizePointCloudColorComponent(
      color[POINT_CLOUD_COLOR_COMPONENT_INDEX.green],
    ),
    blue: normalizePointCloudColorComponent(
      color[POINT_CLOUD_COLOR_COMPONENT_INDEX.blue],
    ),
  };
};

const toHexColor = (red: number, green: number, blue: number): string =>
  `#${[red, green, blue]
    .map((component) =>
      Math.min(
        OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX,
        Math.max(0, Math.round(component)),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const resolveSurfaceFootprintYawRad = (
  samples: readonly OperatorPointCloudColoredWorldSample[],
  centerX: number,
  centerY: number,
): number => {
  let covarianceXx = 0;
  let covarianceYy = 0;
  let covarianceXy = 0;
  for (const sample of samples) {
    const deltaX = sample.x - centerX;
    const deltaY = sample.y - centerY;
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

const collectOperatorPointCloudColoredWorldSamples = (
  frame: OperatorPointCloudFrame,
  floorCalibrationsByCameraId: OperatorPointCloudFloorCalibrationByCameraId = {},
  maxSamples = OPERATOR_POINT_CLOUD_SCENE_MESH_MAX_SAMPLES_PER_FRAME,
): OperatorPointCloudColoredWorldSample[] => {
  const pointCount = getOperatorPointCloudPointCount(frame);
  if (pointCount <= 0) return [];

  const stride = Math.max(1, Math.ceil(pointCount / maxSamples));
  const localPoint = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  const poseTransform = frame.cameraPose
    ? buildOperatorPointCloudPoseTransform(frame.cameraPose)
    : null;
  const posePosition = poseTransform
    ? new THREE.Vector3(...poseTransform.position)
    : null;
  const calibration = floorCalibrationsByCameraId[frame.cameraId] ?? null;
  const samples: OperatorPointCloudColoredWorldSample[] = [];

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
    if (
      !Number.isFinite(worldPoint.x) ||
      !Number.isFinite(worldPoint.y) ||
      !Number.isFinite(worldPoint.z)
    ) {
      continue;
    }

    const color = readOperatorPointCloudColor(frame, pointIndex);
    const leveledSample = applyOperatorPointCloudFloorCalibrationToSample(
      {
        binKey: Math.round(
          worldPoint.z / OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
        ),
        x: worldPoint.x,
        y: worldPoint.y,
        z: worldPoint.z,
      },
      calibration,
    );
    samples.push({
      ...leveledSample,
      ...color,
    });
  }

  return samples;
};

const collectDenseSurfaceBins = (
  samples: readonly OperatorPointCloudColoredWorldSample[],
): OperatorPointCloudSceneMeshBin[] => {
  const bins = new Map<number, OperatorPointCloudSceneMeshBin>();
  for (const sample of samples) {
    const bin = bins.get(sample.binKey);
    if (bin) {
      bin.count += 1;
    } else {
      bins.set(sample.binKey, { binKey: sample.binKey, count: 1 });
    }
  }

  return [...bins.values()].filter(
    (bin) => bin.count >= OPERATOR_POINT_CLOUD_SCENE_MESH_MIN_SURFACE_SAMPLES,
  );
};

const isSceneMeshBinNearSelectedBin = (
  bin: OperatorPointCloudSceneMeshBin,
  selectedBins: readonly OperatorPointCloudSceneMeshBin[],
): boolean =>
  selectedBins.some(
    (selectedBin) =>
      Math.abs(selectedBin.binKey - bin.binKey) <=
      OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW,
  );

const selectSceneMeshSurfaceBins = (
  samples: readonly OperatorPointCloudColoredWorldSample[],
): OperatorPointCloudSceneMeshBin[] => {
  const denseBins = collectDenseSurfaceBins(samples);
  if (denseBins.length === 0) return [];

  const selectedBins = [
    [...denseBins].sort((left, right) => left.binKey - right.binKey)[0],
  ];
  for (const bin of [...denseBins].sort(
    (left, right) => right.count - left.count || left.binKey - right.binKey,
  )) {
    if (selectedBins.length >= OPERATOR_POINT_CLOUD_SCENE_MESH_MAX_SURFACES) {
      break;
    }
    if (!isSceneMeshBinNearSelectedBin(bin, selectedBins)) {
      selectedBins.push(bin);
    }
  }

  return selectedBins.sort((left, right) => left.binKey - right.binKey);
};

const collectSamplesForSurfaceBin = (
  samples: readonly OperatorPointCloudColoredWorldSample[],
  bin: OperatorPointCloudSceneMeshBin,
): OperatorPointCloudColoredWorldSample[] =>
  samples.filter(
    (sample) =>
      Math.abs(sample.binKey - bin.binKey) <=
      OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW,
  );

const collectSamplesForCalibrationPlane = (
  samples: readonly OperatorPointCloudColoredWorldSample[],
  plane: OperatorPointCloudSceneMeshCalibrationPlane,
): OperatorPointCloudColoredWorldSample[] =>
  collectSamplesForSurfaceBin(samples, {
    binKey: Math.round(
      plane.center[2] / OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
    ),
    count: OPERATOR_POINT_CLOUD_SCENE_MESH_MIN_SURFACE_SAMPLES,
  });

const buildColoredSamplesFromCalibrationPlane = (
  plane: OperatorPointCloudSceneMeshCalibrationPlane,
): OperatorPointCloudColoredWorldSample[] =>
  (plane.surfacePoints ?? []).map((point) => ({
    binKey: Math.round(
      point[2] / OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
    ),
    x: point[0],
    y: point[1],
    z: point[2],
    red: OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX,
    green: OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX,
    blue: OPERATOR_POINT_CLOUD_SCENE_MESH_COLOR_MAX,
  }));

const isSceneMeshBinNearCalibrationPlane = (
  bin: OperatorPointCloudSceneMeshBin,
  calibrationPlanes: readonly OperatorPointCloudSceneMeshCalibrationPlane[],
): boolean =>
  calibrationPlanes.some(
    (plane) =>
      Math.abs(
        bin.binKey -
          Math.round(
            plane.center[2] /
              OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
          ),
      ) <= OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW,
  );

const fitSceneMeshForSurfaceSamples = (
  samples: readonly OperatorPointCloudColoredWorldSample[],
  kind: OperatorPointCloudSceneMesh["kind"],
  label: string,
  options: OperatorPointCloudSceneMeshFitOptions = {},
): OperatorPointCloudSceneMesh | null => {
  if (
    samples.length < OPERATOR_POINT_CLOUD_SCENE_MESH_MIN_SURFACE_SAMPLES &&
    !options.fallbackSize
  ) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (const sample of samples) {
    sumX += sample.x;
    sumY += sample.y;
    sumZ += sample.z;
  }

  const fallbackCenter = options.fallbackCenter;
  const centerX = samples.length > 0
    ? sumX / samples.length
    : fallbackCenter?.[0] ?? 0;
  const centerY = samples.length > 0
    ? sumY / samples.length
    : fallbackCenter?.[1] ?? 0;
  const surfaceZ =
    options.surfaceZ ??
    (samples.length > 0 ? sumZ / samples.length : fallbackCenter?.[2] ?? 0);
  const yawRad =
    options.yawRad ?? resolveSurfaceFootprintYawRad(samples, centerX, centerY);
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;

  for (const sample of samples) {
    const deltaX = sample.x - centerX;
    const deltaY = sample.y - centerY;
    const u = deltaX * cosYaw + deltaY * sinYaw;
    const v = -deltaX * sinYaw + deltaY * cosYaw;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  const hasSampleFootprint = samples.length > 0;
  const rawSizeX = hasSampleFootprint ? maxU - minU : 0;
  const rawSizeY = hasSampleFootprint ? maxV - minV : 0;
  const fallbackSizeX = options.fallbackSize?.[0] ?? 0;
  const fallbackSizeY = options.fallbackSize?.[1] ?? 0;
  if (
    Math.max(rawSizeX, fallbackSizeX) <
      OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_MIN_AXIS_LENGTH ||
    Math.max(rawSizeY, fallbackSizeY) <
      OPERATOR_POINT_CLOUD_AUTOCALIBRATION_PLANE_MIN_AXIS_LENGTH ||
    Math.max(rawSizeX * rawSizeY, fallbackSizeX * fallbackSizeY) <
      OPERATOR_POINT_CLOUD_SCENE_MESH_MIN_AREA_M2
  ) {
    return null;
  }

  const localCenterU =
    hasSampleFootprint
      ? (minU + maxU) * OPERATOR_POINT_CLOUD_SCENE_MESH_HALF_EXTENT_FACTOR
      : 0;
  const localCenterV =
    hasSampleFootprint
      ? (minV + maxV) * OPERATOR_POINT_CLOUD_SCENE_MESH_HALF_EXTENT_FACTOR
      : 0;
  const meshCenterX = centerX + localCenterU * cosYaw - localCenterV * sinYaw;
  const meshCenterY = centerY + localCenterU * sinYaw + localCenterV * cosYaw;
  const paddedSizeX = Math.max(
    rawSizeX + OPERATOR_POINT_CLOUD_SCENE_MESH_FOOTPRINT_PADDING_M,
    fallbackSizeX,
  );
  const paddedSizeY = Math.max(
    rawSizeY + OPERATOR_POINT_CLOUD_SCENE_MESH_FOOTPRINT_PADDING_M,
    fallbackSizeY,
  );
  const colorSamples = options.colorSamples ?? samples;
  const colorSum = colorSamples.reduce(
    (accumulator, sample) => ({
      red: accumulator.red + sample.red,
      green: accumulator.green + sample.green,
      blue: accumulator.blue + sample.blue,
    }),
    { red: 0, green: 0, blue: 0 },
  );

  return {
    label,
    kind,
    position: [
      meshCenterX,
      meshCenterY,
      surfaceZ -
        OPERATOR_POINT_CLOUD_SCENE_MESH_THICKNESS_M *
          OPERATOR_POINT_CLOUD_SCENE_MESH_HALF_EXTENT_FACTOR,
    ],
    rotationRpyRad: [0, 0, yawRad],
    size: [
      paddedSizeX,
      paddedSizeY,
      OPERATOR_POINT_CLOUD_SCENE_MESH_THICKNESS_M,
    ],
    color:
      colorSamples.length > 0
        ? toHexColor(
            colorSum.red / colorSamples.length,
            colorSum.green / colorSamples.length,
            colorSum.blue / colorSamples.length,
          )
        : OPERATOR_POINT_CLOUD_SCENE_MESH_DEFAULT_COLOR,
    sampleCount: samples.length,
  };
};

const resolveOperatorPointCloudCalibrationSceneMeshes = (
  calibrationPlanes: readonly OperatorPointCloudSceneMeshCalibrationPlane[],
  samples: readonly OperatorPointCloudColoredWorldSample[],
): OperatorPointCloudSceneMesh[] =>
  calibrationPlanes.flatMap((plane, planeIndex) => {
    const colorSamples = collectSamplesForCalibrationPlane(samples, plane);
    const calibrationFootprintSamples =
      buildColoredSamplesFromCalibrationPlane(plane);
    const footprintSamples =
      calibrationFootprintSamples.length > 0
        ? calibrationFootprintSamples
        : plane.size
          ? []
          : colorSamples;
    const mesh = fitSceneMeshForSurfaceSamples(
      footprintSamples,
      "surface",
      `Cloud calibrated surface ${
        planeIndex + OPERATOR_POINT_CLOUD_SCENE_MESH_LABEL_INDEX_OFFSET
      }`,
      {
        colorSamples,
        fallbackCenter: plane.center,
        fallbackSize: plane.size,
        surfaceZ: plane.center[2],
        yawRad: plane.yawRad,
      },
    );
    return mesh ? [mesh] : [];
  });

const filterUncalibratedSceneMeshBins = (
  selectedBins: readonly OperatorPointCloudSceneMeshBin[],
  calibrationPlanes: readonly OperatorPointCloudSceneMeshCalibrationPlane[],
): OperatorPointCloudSceneMeshBin[] => {
  if (calibrationPlanes.length === 0) return [...selectedBins];
  const lowestCalibrationBinKey = Math.min(
    ...calibrationPlanes.map((plane) =>
      Math.round(
        plane.center[2] /
          OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
      ),
    ),
  );
  return selectedBins.filter(
    (bin) =>
      bin.binKey <
        lowestCalibrationBinKey -
          OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW &&
      !isSceneMeshBinNearCalibrationPlane(bin, calibrationPlanes),
  );
};

export const resolveOperatorPointCloudSceneMeshes = (
  frames: readonly OperatorPointCloudFrame[],
  floorCalibrationsByCameraId: OperatorPointCloudFloorCalibrationByCameraId = {},
  calibrationPlanes: readonly OperatorPointCloudSceneMeshCalibrationPlane[] = [],
): OperatorPointCloudSceneMesh[] => {
  const samples = frames.flatMap((frame) =>
    collectOperatorPointCloudColoredWorldSamples(
      frame,
      floorCalibrationsByCameraId,
    ),
  );
  const calibrationMeshes = resolveOperatorPointCloudCalibrationSceneMeshes(
    calibrationPlanes,
    samples,
  );
  const selectedBins = filterUncalibratedSceneMeshBins(
    selectSceneMeshSurfaceBins(samples),
    calibrationPlanes,
  );
  const hasFloorCandidate =
    selectedBins.length > 1 || calibrationMeshes.length > 0;
  let surfaceIndex = 0;

  const uncalibratedMeshes = selectedBins.flatMap((bin, binIndex) => {
    const kind = hasFloorCandidate && binIndex === 0 ? "floor" : "surface";
    surfaceIndex += kind === "surface" ? 1 : 0;
    const label =
      kind === "floor" ? "Cloud floor" : `Cloud surface ${surfaceIndex}`;
    const mesh = fitSceneMeshForSurfaceSamples(
      collectSamplesForSurfaceBin(samples, bin),
      kind,
      label,
    );
    return mesh ? [mesh] : [];
  });
  return [...uncalibratedMeshes, ...calibrationMeshes];
};
