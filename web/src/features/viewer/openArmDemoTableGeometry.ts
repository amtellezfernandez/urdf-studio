import {
  applyOperatorPointCloudFloorCalibrationToSample,
  collectOperatorPointCloudWorldSamples,
  type OperatorPointCloudFloorCalibrationByCameraId,
  type OperatorPointCloudSurfacePlane,
  type OperatorPointCloudWorldSample,
} from "@/features/teleop/perception/operatorPointCloudFloorCalibration";
import { buildOperatorPointCloudPoseTransform } from "@/features/teleop/perception/operatorPointCloudPose";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";
import {
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW,
} from "@/features/teleop/params/operatorTeleopParams";
import {
  OPENARM_DEMO_TABLE_CALIBRATED_MIN_TOP_SIZE_M,
  OPENARM_DEMO_TABLE_CENTER_X_M,
  OPENARM_DEMO_TABLE_CENTER_Y_M,
  OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M,
  OPENARM_DEMO_TABLE_FIT_CONVERGENCE_EPSILON_M,
  OPENARM_DEMO_TABLE_FIT_SOLVE_MAX_ITERATIONS,
  OPENARM_DEMO_TABLE_FOOTPRINT_CORNER_SIGNS,
  OPENARM_DEMO_TABLE_HEIGHT_BIN_SIZE_M,
  OPENARM_DEMO_TABLE_LEG_BOTTOM_Z_M,
  OPENARM_DEMO_TABLE_LEG_INSET_M,
  OPENARM_DEMO_TABLE_LEG_LOCAL_OFFSETS,
  OPENARM_DEMO_TABLE_LEG_MIN_HEIGHT_M,
  OPENARM_DEMO_TABLE_LEG_SIZE_M,
  OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
  OPENARM_DEMO_TABLE_POINT_CLOUD_FIT_PADDING_M,
  OPENARM_DEMO_TABLE_POINT_CLOUD_MAX_HEIGHT_SAMPLES,
  OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT,
  OPENARM_DEMO_TABLE_TOP_SURFACE_ABOVE_FLOOR_M,
  OPENARM_DEMO_TABLE_TOP_SIZE_M,
  OPENARM_DEMO_TABLE_TOP_SURFACE_Z_M,
  OPENARM_DEMO_TABLE_YAW_COVARIANCE_CROSS_FACTOR,
  OPENARM_DEMO_TABLE_YAW_HALF_ANGLE_FACTOR,
} from "@/features/viewer/openArmDemoTableParams";

export type OpenArmDemoTableGeometry = {
  legs: Array<{
    position: [number, number, number];
    rotation: [number, number, number];
    size: [number, number, number];
  }>;
  tabletopPosition: [number, number, number];
  tabletopRotation: [number, number, number];
  tabletopSize: [number, number, number];
  tabletopBackEdgeX: number;
  tabletopSurfaceZ: number;
  tabletopYawRad: number;
};

type OpenArmDemoTableHeightBin = {
  binKey: number;
  count: number;
  surfaceZ: number;
};

type OpenArmDemoTableTopSize = {
  x: number;
  y: number;
  z: number;
};

export type OpenArmDemoTablePose = {
  centerX: number;
  centerY: number;
  surfaceZ: number;
  topSize: OpenArmDemoTableTopSize;
  yawRad: number;
};

export type OpenArmDemoTableCalibrationPlane = Pick<
  OperatorPointCloudSurfacePlane,
  "center" | "surfacePoints" | "yawRad"
> &
  Partial<Pick<OperatorPointCloudSurfacePlane, "size">>;

type OpenArmDemoTablePoint2 = {
  x: number;
  y: number;
};

type OpenArmDemoTableTopSizeFloor = {
  x: number;
  y: number;
};

const OPENARM_DEMO_TABLE_DEFAULT_TOP_SIZE: OpenArmDemoTableTopSize = {
  x: OPENARM_DEMO_TABLE_TOP_SIZE_M.x,
  y: OPENARM_DEMO_TABLE_TOP_SIZE_M.y,
  z: OPENARM_DEMO_TABLE_TOP_SIZE_M.z,
};
const OPENARM_DEMO_TABLE_CALIBRATED_MIN_TOP_SIZE: OpenArmDemoTableTopSizeFloor = {
  x: OPENARM_DEMO_TABLE_CALIBRATED_MIN_TOP_SIZE_M.x,
  y: OPENARM_DEMO_TABLE_CALIBRATED_MIN_TOP_SIZE_M.y,
};

const collectOpenArmTablePointSamples = (
  frames: readonly OperatorPointCloudFrame[],
  floorCalibrationsByCameraId: OperatorPointCloudFloorCalibrationByCameraId = {},
): OperatorPointCloudWorldSample[] => {
  const samples: OperatorPointCloudWorldSample[] = [];
  const calibratedSamples: OperatorPointCloudWorldSample[] = [];

  for (const frame of frames) {
    const poseTransform = frame.cameraPose
      ? buildOperatorPointCloudPoseTransform(frame.cameraPose)
      : null;
    const frameSamples = collectOperatorPointCloudWorldSamples(
      frame,
      poseTransform,
      OPENARM_DEMO_TABLE_POINT_CLOUD_MAX_HEIGHT_SAMPLES,
    );
    samples.push(...frameSamples);
    const calibration = floorCalibrationsByCameraId[frame.cameraId] ?? null;
    calibratedSamples.push(
      ...frameSamples.map((sample) =>
        applyOperatorPointCloudFloorCalibrationToSample(sample, calibration),
      ),
    );
  }

  return calibratedSamples.length > 0 ? calibratedSamples : samples;
};

const collectOpenArmTableHeightBins = (
  samples: readonly OperatorPointCloudWorldSample[],
): OpenArmDemoTableHeightBin[] => {
  const bins = new Map<number, OpenArmDemoTableHeightBin>();

  for (const sample of samples) {
    const surfaceZ = sample.binKey * OPENARM_DEMO_TABLE_HEIGHT_BIN_SIZE_M;
    const bin = bins.get(sample.binKey);
    if (bin) {
      bin.count += 1;
    } else {
      bins.set(sample.binKey, { binKey: sample.binKey, count: 1, surfaceZ });
    }
  }

  return [...bins.values()]
    .filter((bin) => bin.count >= OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT)
    .sort((left, right) => left.surfaceZ - right.surfaceZ);
};

const resolveOpenArmDemoTableDominantNonFloorSurfaceBin = (
  samples: readonly OperatorPointCloudWorldSample[],
): OpenArmDemoTableHeightBin | null => {
  const bins = collectOpenArmTableHeightBins(samples);
  if (bins.length <= 1) return bins[0] ?? null;

  const floorBin = bins[0];
  const nonFloorBins = bins.filter(
    (bin) =>
      bin.binKey >
      floorBin.binKey + OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW,
  );
  const candidates = nonFloorBins.length > 0 ? nonFloorBins : bins.slice(1);
  return (
    candidates.sort(
      (left, right) =>
        right.count - left.count || right.surfaceZ - left.surfaceZ,
    )[0] ?? null
  );
};

const resolveOpenArmDemoTableHalfExtentX = (
  yawRad: number,
  topSize: OpenArmDemoTableTopSize = OPENARM_DEMO_TABLE_DEFAULT_TOP_SIZE,
): number =>
  (Math.abs(Math.cos(yawRad)) * topSize.x +
    Math.abs(Math.sin(yawRad)) * topSize.y) *
  OPENARM_DEMO_TABLE_YAW_HALF_ANGLE_FACTOR;

const resolveOpenArmDemoTableCenterX = (
  centerX: number,
  yawRad: number,
  topSize: OpenArmDemoTableTopSize = OPENARM_DEMO_TABLE_DEFAULT_TOP_SIZE,
): number =>
  Math.max(
    centerX,
    OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M +
      resolveOpenArmDemoTableHalfExtentX(yawRad, topSize),
  );

const projectOpenArmDemoTablePointToYawAxes = (
  point: OpenArmDemoTablePoint2,
  yawRad: number,
): OpenArmDemoTablePoint2 => {
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  return {
    x: point.x * cosYaw + point.y * sinYaw,
    y: -point.x * sinYaw + point.y * cosYaw,
  };
};

const resolveOpenArmDemoTablePointFromYawAxes = (
  point: OpenArmDemoTablePoint2,
  yawRad: number,
): OpenArmDemoTablePoint2 => {
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  return {
    x: point.x * cosYaw - point.y * sinYaw,
    y: point.x * sinYaw + point.y * cosYaw,
  };
};

const collectOpenArmDemoTableSurfaceSamplesForBin = (
  samples: readonly OperatorPointCloudWorldSample[],
  surfaceBin: OpenArmDemoTableHeightBin,
): OperatorPointCloudWorldSample[] => {
  const minSurfaceBinKey =
    surfaceBin.binKey - OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW;
  const maxSurfaceBinKey =
    surfaceBin.binKey + OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_FLOOR_BIN_WINDOW;
  return samples.filter(
    (sample) =>
      sample.binKey >= minSurfaceBinKey && sample.binKey <= maxSurfaceBinKey,
  );
};

const collectOpenArmDemoTableSurfaceFootprintPoints = (
  calibrationPlanes: readonly OpenArmDemoTableCalibrationPlane[],
): OpenArmDemoTablePoint2[] => {
  const points: OpenArmDemoTablePoint2[] = [];
  for (const plane of calibrationPlanes) {
    if (plane.surfacePoints && plane.surfacePoints.length > 0) {
      points.push(
        ...plane.surfacePoints.map(([x, y]) => ({
          x,
          y,
        })),
      );
      continue;
    }

    const halfSizeX =
      (plane.size?.[0] ?? OPENARM_DEMO_TABLE_POINT_CLOUD_FIT_PADDING_M) *
      OPENARM_DEMO_TABLE_YAW_HALF_ANGLE_FACTOR;
    const halfSizeY =
      (plane.size?.[1] ?? OPENARM_DEMO_TABLE_POINT_CLOUD_FIT_PADDING_M) *
      OPENARM_DEMO_TABLE_YAW_HALF_ANGLE_FACTOR;
    const cosYaw = Math.cos(plane.yawRad);
    const sinYaw = Math.sin(plane.yawRad);
    for (const [signX, signY] of OPENARM_DEMO_TABLE_FOOTPRINT_CORNER_SIGNS) {
      const localX = signX * halfSizeX;
      const localY = signY * halfSizeY;
      points.push({
        x: Math.max(
          OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M,
          plane.center[0] + localX * cosYaw - localY * sinYaw,
        ),
        y: plane.center[1] + localX * sinYaw + localY * cosYaw,
      });
    }
  }
  return points;
};

const resolveOpenArmDemoTableFitToFootprint = (
  calibrationPlanes: readonly OpenArmDemoTableCalibrationPlane[],
  yawRad: number,
  minimumTopSize: OpenArmDemoTableTopSizeFloor =
    OPENARM_DEMO_TABLE_CALIBRATED_MIN_TOP_SIZE,
): Pick<OpenArmDemoTablePose, "centerX" | "centerY" | "topSize"> | null => {
  const footprintPoints =
    collectOpenArmDemoTableSurfaceFootprintPoints(calibrationPlanes);
  if (footprintPoints.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of footprintPoints) {
    const projected = projectOpenArmDemoTablePointToYawAxes(point, yawRad);
    minX = Math.min(minX, projected.x);
    maxX = Math.max(maxX, projected.x);
    minY = Math.min(minY, projected.y);
    maxY = Math.max(maxY, projected.y);
  }

  const projectedCenter = {
    x: (minX + maxX) * OPENARM_DEMO_TABLE_YAW_HALF_ANGLE_FACTOR,
    y: (minY + maxY) * OPENARM_DEMO_TABLE_YAW_HALF_ANGLE_FACTOR,
  };
  const worldCenter = resolveOpenArmDemoTablePointFromYawAxes(
    projectedCenter,
    yawRad,
  );
  let centerX = worldCenter.x;
  const centerY = worldCenter.y;
  const resolveTopSizeForCenter = (
    candidateCenterX: number,
  ): OpenArmDemoTableTopSize => {
    let maxAbsX = 0;
    let maxAbsY = 0;
    for (const point of footprintPoints) {
      const relativePoint = projectOpenArmDemoTablePointToYawAxes(
        {
          x: point.x - candidateCenterX,
          y: point.y - centerY,
        },
        yawRad,
      );
      maxAbsX = Math.max(maxAbsX, Math.abs(relativePoint.x));
      maxAbsY = Math.max(maxAbsY, Math.abs(relativePoint.y));
    }

    return {
      x: Math.max(
        minimumTopSize.x,
        maxAbsX / OPENARM_DEMO_TABLE_YAW_HALF_ANGLE_FACTOR +
          OPENARM_DEMO_TABLE_POINT_CLOUD_FIT_PADDING_M,
      ),
      y: Math.max(
        minimumTopSize.y,
        maxAbsY / OPENARM_DEMO_TABLE_YAW_HALF_ANGLE_FACTOR +
          OPENARM_DEMO_TABLE_POINT_CLOUD_FIT_PADDING_M,
      ),
      z: OPENARM_DEMO_TABLE_TOP_SIZE_M.z,
    };
  };
  let topSize = resolveTopSizeForCenter(centerX);

  for (
    let iteration = 0;
    iteration < OPENARM_DEMO_TABLE_FIT_SOLVE_MAX_ITERATIONS;
    iteration += 1
  ) {
    const nextCenterX = resolveOpenArmDemoTableCenterX(centerX, yawRad, topSize);
    const centerShift = Math.abs(nextCenterX - centerX);
    centerX = nextCenterX;

    const nextTopSize = resolveTopSizeForCenter(centerX);
    const sizeShift = Math.max(
      Math.abs(nextTopSize.x - topSize.x),
      Math.abs(nextTopSize.y - topSize.y),
    );
    topSize = nextTopSize;
    if (
      centerShift < OPENARM_DEMO_TABLE_FIT_CONVERGENCE_EPSILON_M &&
      sizeShift < OPENARM_DEMO_TABLE_FIT_CONVERGENCE_EPSILON_M
    ) {
      break;
    }
  }

  for (
    let iteration = 0;
    iteration < OPENARM_DEMO_TABLE_FIT_SOLVE_MAX_ITERATIONS;
    iteration += 1
  ) {
    const nextCenterX = resolveOpenArmDemoTableCenterX(centerX, yawRad, topSize);
    const nextTopSize = resolveTopSizeForCenter(nextCenterX);
    const centerShift = Math.abs(nextCenterX - centerX);
    const sizeShift = Math.max(
      Math.abs(nextTopSize.x - topSize.x),
      Math.abs(nextTopSize.y - topSize.y),
    );
    centerX = nextCenterX;
    topSize = nextTopSize;
    if (
      centerShift < OPENARM_DEMO_TABLE_FIT_CONVERGENCE_EPSILON_M &&
      sizeShift < OPENARM_DEMO_TABLE_FIT_CONVERGENCE_EPSILON_M
    ) {
      break;
    }
  }

  return {
    centerX,
    centerY,
    topSize,
  };
};

const resolveOpenArmDemoTableSurfaceFootprintPose = (
  surfaceSamples: readonly OperatorPointCloudWorldSample[],
): Pick<OpenArmDemoTablePose, "centerX" | "centerY" | "topSize" | "yawRad"> => {
  if (surfaceSamples.length < OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT) {
    return {
      centerX: OPENARM_DEMO_TABLE_CENTER_X_M,
      centerY: OPENARM_DEMO_TABLE_CENTER_Y_M,
      topSize: OPENARM_DEMO_TABLE_DEFAULT_TOP_SIZE,
      yawRad: OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
    };
  }

  let sumX = 0;
  let sumY = 0;
  for (const sample of surfaceSamples) {
    sumX += sample.x;
    sumY += sample.y;
  }

  const centerX = sumX / surfaceSamples.length;
  const centerY = sumY / surfaceSamples.length;
  let covarianceXx = 0;
  let covarianceYy = 0;
  let covarianceXy = 0;
  for (const sample of surfaceSamples) {
    const deltaX = sample.x - centerX;
    const deltaY = sample.y - centerY;
    covarianceXx += deltaX * deltaX;
    covarianceYy += deltaY * deltaY;
    covarianceXy += deltaX * deltaY;
  }

  const yawRad =
    OPENARM_DEMO_TABLE_YAW_HALF_ANGLE_FACTOR *
    Math.atan2(
      OPENARM_DEMO_TABLE_YAW_COVARIANCE_CROSS_FACTOR * covarianceXy,
      covarianceXx - covarianceYy,
    );
  const stableYawRad = Number.isFinite(yawRad)
    ? yawRad
    : OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD;

  return {
    centerX: resolveOpenArmDemoTableCenterX(centerX, stableYawRad),
    centerY,
    topSize: OPENARM_DEMO_TABLE_DEFAULT_TOP_SIZE,
    yawRad: stableYawRad,
  };
};

const resolveOpenArmDemoTableSurfaceFootprintSize = (
  samples: readonly OperatorPointCloudWorldSample[],
  pose: Pick<OpenArmDemoTablePose, "centerX" | "centerY" | "yawRad">,
): [number, number] => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    const projected = projectOpenArmDemoTablePointToYawAxes(
      {
        x: sample.x - pose.centerX,
        y: sample.y - pose.centerY,
      },
      pose.yawRad,
    );
    minX = Math.min(minX, projected.x);
    maxX = Math.max(maxX, projected.x);
    minY = Math.min(minY, projected.y);
    maxY = Math.max(maxY, projected.y);
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return [
      OPENARM_DEMO_TABLE_POINT_CLOUD_FIT_PADDING_M,
      OPENARM_DEMO_TABLE_POINT_CLOUD_FIT_PADDING_M,
    ];
  }

  return [
    maxX - minX + OPENARM_DEMO_TABLE_POINT_CLOUD_FIT_PADDING_M,
    maxY - minY + OPENARM_DEMO_TABLE_POINT_CLOUD_FIT_PADDING_M,
  ];
};

export const resolveOpenArmDemoTablePose = (
  frames: readonly OperatorPointCloudFrame[],
  floorCalibrationsByCameraId: OperatorPointCloudFloorCalibrationByCameraId = {},
): OpenArmDemoTablePose => {
  const samples = collectOpenArmTablePointSamples(frames, floorCalibrationsByCameraId);
  const surfaceBins = collectOpenArmTableHeightBins(samples);
  const floorBin = surfaceBins[0];
  if (!floorBin) {
    return {
      centerX: OPENARM_DEMO_TABLE_CENTER_X_M,
      centerY: OPENARM_DEMO_TABLE_CENTER_Y_M,
      surfaceZ: OPENARM_DEMO_TABLE_TOP_SURFACE_Z_M,
      topSize: OPENARM_DEMO_TABLE_DEFAULT_TOP_SIZE,
      yawRad: OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
    };
  }

  const floorSamples = samples.filter((sample) => sample.binKey === floorBin.binKey);
  const footprintPose = resolveOpenArmDemoTableSurfaceFootprintPose(floorSamples);

  return {
    ...footprintPose,
    surfaceZ: floorBin.surfaceZ + OPENARM_DEMO_TABLE_TOP_SURFACE_ABOVE_FLOOR_M,
  };
};

export const resolveOpenArmDemoTablePoseFromCalibrationPlanes = (
  calibrationPlanes: readonly OpenArmDemoTableCalibrationPlane[],
): OpenArmDemoTablePose | null => {
  if (calibrationPlanes.length === 0) return null;

  let centerX = 0;
  let centerY = 0;
  let surfaceZ = 0;
  let yawSin = 0;
  let yawCos = 0;
  for (const plane of calibrationPlanes) {
    centerX += plane.center[0];
    centerY += plane.center[1];
    surfaceZ += plane.center[2];
    yawSin += Math.sin(plane.yawRad);
    yawCos += Math.cos(plane.yawRad);
  }

  const yawRad = Math.atan2(yawSin, yawCos);
  const stableYawRad = Number.isFinite(yawRad)
    ? yawRad
    : OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD;
  const fittedFootprint = resolveOpenArmDemoTableFitToFootprint(
    calibrationPlanes,
    stableYawRad,
  );
  const averageCenterX = centerX / calibrationPlanes.length;
  return {
    centerX:
      fittedFootprint?.centerX ??
      resolveOpenArmDemoTableCenterX(averageCenterX, stableYawRad),
    centerY: fittedFootprint?.centerY ?? centerY / calibrationPlanes.length,
    surfaceZ: surfaceZ / calibrationPlanes.length,
    topSize: fittedFootprint?.topSize ?? OPENARM_DEMO_TABLE_DEFAULT_TOP_SIZE,
    yawRad: stableYawRad,
  };
};

export const resolveOpenArmDemoTableCalibrationPlanesFromPointCloudFrames = (
  frames: readonly OperatorPointCloudFrame[],
  floorCalibrationsByCameraId: OperatorPointCloudFloorCalibrationByCameraId = {},
): OpenArmDemoTableCalibrationPlane[] => {
  const calibrationPlanes: OpenArmDemoTableCalibrationPlane[] = [];
  for (const frame of frames) {
    const poseTransform = frame.cameraPose
      ? buildOperatorPointCloudPoseTransform(frame.cameraPose)
      : null;
    const samples = collectOperatorPointCloudWorldSamples(
      frame,
      poseTransform,
      OPENARM_DEMO_TABLE_POINT_CLOUD_MAX_HEIGHT_SAMPLES,
    ).map((sample) =>
      applyOperatorPointCloudFloorCalibrationToSample(
        sample,
        floorCalibrationsByCameraId[frame.cameraId] ?? null,
      ),
    );
    const tableSurfaceBin =
      resolveOpenArmDemoTableDominantNonFloorSurfaceBin(samples);
    if (!tableSurfaceBin) continue;
    const upperSurfaceSamples = collectOpenArmDemoTableSurfaceSamplesForBin(
      samples,
      tableSurfaceBin,
    );
    const footprintPose =
      resolveOpenArmDemoTableSurfaceFootprintPose(upperSurfaceSamples);
    calibrationPlanes.push({
      center: [
        footprintPose.centerX,
        footprintPose.centerY,
        tableSurfaceBin.surfaceZ,
      ],
      surfacePoints: upperSurfaceSamples.map((sample) => [
        sample.x,
        sample.y,
        sample.z,
      ]),
      size: resolveOpenArmDemoTableSurfaceFootprintSize(
        upperSurfaceSamples,
        footprintPose,
      ),
      yawRad: footprintPose.yawRad,
    });
  }
  return calibrationPlanes;
};

export const resolveOpenArmDemoTablePoseFromCalibrationPlanesAndPointCloudFrames = (
  calibrationPlanes: readonly OpenArmDemoTableCalibrationPlane[],
  frames: readonly OperatorPointCloudFrame[],
  floorCalibrationsByCameraId: OperatorPointCloudFloorCalibrationByCameraId = {},
): OpenArmDemoTablePose | null => {
  const liveCalibrationPlanes =
    resolveOpenArmDemoTableCalibrationPlanesFromPointCloudFrames(
      frames,
      floorCalibrationsByCameraId,
    );
  return resolveOpenArmDemoTablePoseFromCalibrationPlanes([
    ...calibrationPlanes,
    ...liveCalibrationPlanes,
  ]);
};

export const resolveOpenArmDemoTableSurfaceZ = (
  frames: readonly OperatorPointCloudFrame[],
): number => {
  return resolveOpenArmDemoTablePose(frames).surfaceZ;
};

export const buildOpenArmDemoTableGeometry = (
  pose: OpenArmDemoTablePose = {
    centerX: OPENARM_DEMO_TABLE_CENTER_X_M,
    centerY: OPENARM_DEMO_TABLE_CENTER_Y_M,
    surfaceZ: OPENARM_DEMO_TABLE_TOP_SURFACE_Z_M,
    topSize: OPENARM_DEMO_TABLE_DEFAULT_TOP_SIZE,
    yawRad: OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
  },
): OpenArmDemoTableGeometry => {
  const tabletopPosition: [number, number, number] = [
    pose.centerX,
    pose.centerY,
    pose.surfaceZ - pose.topSize.z / 2,
  ];
  const tabletopRotation: [number, number, number] = [
    OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
    OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
    pose.yawRad,
  ];
  const tabletopSize: [number, number, number] = [
    pose.topSize.x,
    pose.topSize.y,
    pose.topSize.z,
  ];
  const legTopZ = pose.surfaceZ - pose.topSize.z;
  const legHeight = Math.max(
    OPENARM_DEMO_TABLE_LEG_MIN_HEIGHT_M,
    legTopZ - OPENARM_DEMO_TABLE_LEG_BOTTOM_Z_M,
  );
  const legCenterZ = OPENARM_DEMO_TABLE_LEG_BOTTOM_Z_M + legHeight / 2;
  const legLocalHalfX =
    pose.topSize.x / 2 - OPENARM_DEMO_TABLE_LEG_INSET_M;
  const legLocalHalfY =
    pose.topSize.y / 2 - OPENARM_DEMO_TABLE_LEG_INSET_M;
  const cosYaw = Math.cos(pose.yawRad);
  const sinYaw = Math.sin(pose.yawRad);
  const legs = OPENARM_DEMO_TABLE_LEG_LOCAL_OFFSETS.map(([signX, signY]) => {
    const localX = signX * legLocalHalfX;
    const localY = signY * legLocalHalfY;
    return {
      position: [
        pose.centerX + localX * cosYaw - localY * sinYaw,
        pose.centerY + localX * sinYaw + localY * cosYaw,
        legCenterZ,
      ] as [number, number, number],
      rotation: [
        OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
        OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
        pose.yawRad,
      ] as [number, number, number],
      size: [
        OPENARM_DEMO_TABLE_LEG_SIZE_M.x,
        OPENARM_DEMO_TABLE_LEG_SIZE_M.y,
        legHeight,
      ] as [number, number, number],
    };
  });
  const tabletopBackEdgeX =
    tabletopPosition[0] -
    resolveOpenArmDemoTableHalfExtentX(pose.yawRad, pose.topSize);

  return {
    legs,
    tabletopPosition,
    tabletopRotation,
    tabletopSize,
    tabletopBackEdgeX,
    tabletopSurfaceZ: pose.surfaceZ,
    tabletopYawRad: pose.yawRad,
  };
};
