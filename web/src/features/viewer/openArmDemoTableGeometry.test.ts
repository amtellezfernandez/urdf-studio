import { describe, expect, it } from "vitest";
import {
  buildOpenArmDemoTableGeometry,
  resolveOpenArmDemoTableCalibrationPlanesFromPointCloudFrames,
  resolveOpenArmDemoTablePose,
  resolveOpenArmDemoTablePoseFromCalibrationPlanes,
  resolveOpenArmDemoTablePoseFromCalibrationPlanesAndPointCloudFrames,
  resolveOpenArmDemoTableSurfaceZ,
} from "@/features/viewer/openArmDemoTableGeometry";
import { OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS } from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";
import {
  OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M,
  OPENARM_DEMO_TABLE_CENTER_X_M,
  OPENARM_DEMO_TABLE_CENTER_Y_M,
  OPENARM_DEMO_TABLE_FOOTPRINT_CORNER_SIGNS,
  OPENARM_DEMO_TABLE_LEG_COUNT,
  OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
  OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT,
  OPENARM_DEMO_TABLE_TOP_SURFACE_ABOVE_FLOOR_M,
  OPENARM_DEMO_TABLE_TOP_SIZE_M,
  OPENARM_DEMO_TABLE_TOP_SURFACE_Z_M,
} from "@/features/viewer/openArmDemoTableParams";

const TEST_OPENARM_DEMO_TABLE_POINT_CLOUD = {
  cameraId: "openarm-depth-camera",
  frameId: "openarm-depth-camera",
  sequence: 1,
  sourceTsMs: 1_000,
  floorSurfaceZ: 0,
  tabletopNoiseSurfaceZ: 0.18,
  floorSampleX: 0.4,
  tabletopNoiseSampleX: 0.5,
  sampleY: 0,
  orientedCenterX: 1.2,
  orientedCenterY: 0.25,
  orientedYawRad: Math.PI / 6,
  orientedLongitudinalStepM: 0.04,
  orientedCenteringDivisor: 2,
  orientedLastIndexOffset: 1,
  calibrationPlaneCenter: [0.72, 0.18, 0.11] as [number, number, number],
  calibrationPlaneYawRad: Math.PI / 5,
  wideCalibrationPlaneCenter: [1.2, 0.18, 0.11] as [number, number, number],
  wideCalibrationPlaneSize: [2, 0.6] as [number, number],
  dominantSurfaceMultiplier: 2,
  bootstrapGridColumns: 8,
  bootstrapGridSpacingM: 0.02,
  sparseHighSurfaceZ: 0.42,
  sparseHighSurfaceSampleCount: OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT,
  sparseHighSurfaceX: 2.8,
  sparseHighSurfaceY: -1.8,
  tabletopSurfaceFootprintPoints: [
    [0.46, -0.22, 0.18],
    [0.86, -0.21, 0.18],
    [0.88, 0.33, 0.18],
    [0.44, 0.34, 0.18],
    [0.64, 0.05, 0.18],
  ] as const,
  tabletopSurfacePointRepeats: 5,
  floorOutlierPoint: [3.2, 3.1, 0] as const,
  floorOutlierRepeats: 48,
  backEdgeToleranceM: 1e-9,
  pointContainmentToleranceM: 1e-6,
  intrinsics: {
    width: 1280,
    height: 720,
    fx: 920,
    fy: 920,
    ppx: 640,
    ppy: 360,
  },
} as const;

const collectTablePlaneCorners = (
  center: [number, number, number],
  size: [number, number],
  yawRad: number,
) => {
  const halfX = size[0] / 2;
  const halfY = size[1] / 2;
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  return OPENARM_DEMO_TABLE_FOOTPRINT_CORNER_SIGNS.map(([signX, signY]) => {
    const localX = signX * halfX;
    const localY = signY * halfY;
    return {
      x: center[0] + localX * cosYaw - localY * sinYaw,
      y: center[1] + localX * sinYaw + localY * cosYaw,
    };
  });
};

const expectPointInsideTabletop = (
  geometry: ReturnType<typeof buildOpenArmDemoTableGeometry>,
  point: { x: number; y: number },
) => {
  const deltaX = point.x - geometry.tabletopPosition[0];
  const deltaY = point.y - geometry.tabletopPosition[1];
  const cosYaw = Math.cos(geometry.tabletopYawRad);
  const sinYaw = Math.sin(geometry.tabletopYawRad);
  const localX = deltaX * cosYaw + deltaY * sinYaw;
  const localY = -deltaX * sinYaw + deltaY * cosYaw;
  expect(Math.abs(localX)).toBeLessThanOrEqual(
    geometry.tabletopSize[0] / 2 +
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.pointContainmentToleranceM,
  );
  expect(Math.abs(localY)).toBeLessThanOrEqual(
    geometry.tabletopSize[1] / 2 +
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.pointContainmentToleranceM,
  );
};

const expectPointOutsideTabletop = (
  geometry: ReturnType<typeof buildOpenArmDemoTableGeometry>,
  point: { x: number; y: number },
) => {
  const deltaX = point.x - geometry.tabletopPosition[0];
  const deltaY = point.y - geometry.tabletopPosition[1];
  const cosYaw = Math.cos(geometry.tabletopYawRad);
  const sinYaw = Math.sin(geometry.tabletopYawRad);
  const localX = deltaX * cosYaw + deltaY * sinYaw;
  const localY = -deltaX * sinYaw + deltaY * cosYaw;
  const outsideX =
    Math.abs(localX) >
    geometry.tabletopSize[0] / 2 +
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.backEdgeToleranceM;
  const outsideY =
    Math.abs(localY) >
    geometry.tabletopSize[1] / 2 +
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.backEdgeToleranceM;
  expect(outsideX || outsideY).toBe(true);
};

const buildFlatPointCloudFrame = (
  floorSampleCount: number,
  tabletopSampleCount: number,
): OperatorPointCloudFrame => {
  const pointCount = floorSampleCount + tabletopSampleCount;
  const pointsXyzFlat = new Float32Array(
    pointCount * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS,
  );
  let pointIndex = 0;
  const writePoint = (x: number, y: number, z: number) => {
    const offset = pointIndex * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS;
    pointsXyzFlat[offset] = x;
    pointsXyzFlat[offset + 1] = y;
    pointsXyzFlat[offset + OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS - 1] = z;
    pointIndex += 1;
  };

  for (let index = 0; index < floorSampleCount; index += 1) {
    writePoint(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorSampleX,
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sampleY,
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorSurfaceZ,
    );
  }
  for (let index = 0; index < tabletopSampleCount; index += 1) {
    writePoint(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopNoiseSampleX,
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sampleY,
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopNoiseSurfaceZ,
    );
  }

  return {
    cameraId: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.cameraId,
    frameId: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.frameId,
    coordinateFrame: "robot_world",
    sequence: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sequence,
    sourceTsMs: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sourceTsMs,
    intrinsics: { ...TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.intrinsics },
    pointsXyz: [],
    colorsRgb: [],
    pointsXyzFlat,
    pointCount,
  };
};

const buildOrientedFloorPointCloudFrame = (): OperatorPointCloudFrame => {
  const pointCount = OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT;
  const pointsXyzFlat = new Float32Array(
    pointCount * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS,
  );
  const cosYaw = Math.cos(TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.orientedYawRad);
  const sinYaw = Math.sin(TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.orientedYawRad);

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const centeredIndex =
      pointIndex -
      (pointCount - TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.orientedLastIndexOffset) /
        TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.orientedCenteringDivisor;
    const localX =
      centeredIndex * TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.orientedLongitudinalStepM;
    const offset = pointIndex * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS;
    pointsXyzFlat[offset] =
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.orientedCenterX +
      localX * cosYaw;
    pointsXyzFlat[offset + 1] =
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.orientedCenterY +
      localX * sinYaw;
    pointsXyzFlat[offset + OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS - 1] =
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorSurfaceZ;
  }

  return {
    cameraId: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.cameraId,
    frameId: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.frameId,
    coordinateFrame: "robot_world",
    sequence: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sequence,
    sourceTsMs: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sourceTsMs,
    intrinsics: { ...TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.intrinsics },
    pointsXyz: [],
    colorsRgb: [],
    pointsXyzFlat,
    pointCount,
  };
};

const buildBootstrapSurfacePointCloudFrame = (): OperatorPointCloudFrame => {
  const floorSampleCount = OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT;
  const tabletopSampleCount =
    OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT *
    TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.dominantSurfaceMultiplier;
  const highSurfaceSampleCount =
    TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sparseHighSurfaceSampleCount;
  const pointCount =
    floorSampleCount + tabletopSampleCount + highSurfaceSampleCount;
  const pointsXyzFlat = new Float32Array(
    pointCount * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS,
  );
  let pointIndex = 0;
  const writePoint = (x: number, y: number, z: number) => {
    const offset = pointIndex * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS;
    pointsXyzFlat[offset] = x;
    pointsXyzFlat[offset + 1] = y;
    pointsXyzFlat[offset + OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS - 1] = z;
    pointIndex += 1;
  };

  for (let index = 0; index < floorSampleCount; index += 1) {
    writePoint(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorSampleX,
      index * TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.bootstrapGridSpacingM,
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorSurfaceZ,
    );
  }
  for (let index = 0; index < tabletopSampleCount; index += 1) {
    const column =
      index % TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.bootstrapGridColumns;
    const row =
      (index - column) /
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.bootstrapGridColumns;
    writePoint(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopNoiseSampleX +
        column * TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.bootstrapGridSpacingM,
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sampleY +
        row * TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.bootstrapGridSpacingM,
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopNoiseSurfaceZ,
    );
  }
  for (let index = 0; index < highSurfaceSampleCount; index += 1) {
    writePoint(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sparseHighSurfaceX,
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sparseHighSurfaceY +
        index * TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.bootstrapGridSpacingM,
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sparseHighSurfaceZ,
    );
  }

  return {
    cameraId: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.cameraId,
    frameId: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.frameId,
    coordinateFrame: "robot_world",
    sequence: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sequence,
    sourceTsMs: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sourceTsMs,
    intrinsics: { ...TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.intrinsics },
    pointsXyz: [],
    colorsRgb: [],
    pointsXyzFlat,
    pointCount,
  };
};

const buildTwoLevelTabletopFootprintPointCloudFrame = (): OperatorPointCloudFrame => {
  const tabletopPointCount =
    TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopSurfaceFootprintPoints.length *
    TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopSurfacePointRepeats;
  const pointCount =
    TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorOutlierRepeats + tabletopPointCount;
  const pointsXyzFlat = new Float32Array(
    pointCount * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS,
  );
  let pointIndex = 0;
  const writePoint = (x: number, y: number, z: number) => {
    const offset = pointIndex * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS;
    pointsXyzFlat[offset] = x;
    pointsXyzFlat[offset + 1] = y;
    pointsXyzFlat[offset + OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS - 1] = z;
    pointIndex += 1;
  };

  for (
    let index = 0;
    index < TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorOutlierRepeats;
    index += 1
  ) {
    writePoint(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorOutlierPoint[0],
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorOutlierPoint[1],
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorOutlierPoint[2],
    );
  }

  for (const point of TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopSurfaceFootprintPoints) {
    for (
      let repeat = 0;
      repeat < TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopSurfacePointRepeats;
      repeat += 1
    ) {
      writePoint(point[0], point[1], point[2]);
    }
  }

  return {
    cameraId: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.cameraId,
    frameId: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.frameId,
    coordinateFrame: "robot_world",
    sequence: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sequence,
    sourceTsMs: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sourceTsMs,
    intrinsics: { ...TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.intrinsics },
    pointsXyz: [],
    colorsRgb: [],
    pointsXyzFlat,
    pointCount,
  };
};

describe("openArmDemoTableGeometry", () => {
  it("places the tabletop surface below the OpenArm point-cloud workspace", () => {
    const geometry = buildOpenArmDemoTableGeometry();

    expect(geometry.tabletopSize).toEqual([
      OPENARM_DEMO_TABLE_TOP_SIZE_M.x,
      OPENARM_DEMO_TABLE_TOP_SIZE_M.y,
      OPENARM_DEMO_TABLE_TOP_SIZE_M.z,
    ]);
    expect(geometry.tabletopPosition).toEqual([
      OPENARM_DEMO_TABLE_CENTER_X_M,
      OPENARM_DEMO_TABLE_CENTER_Y_M,
      OPENARM_DEMO_TABLE_TOP_SURFACE_Z_M - OPENARM_DEMO_TABLE_TOP_SIZE_M.z / 2,
    ]);
    expect(geometry.tabletopRotation).toEqual([
      OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
      OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
      OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
    ]);
    expect(geometry.tabletopSurfaceZ).toBe(OPENARM_DEMO_TABLE_TOP_SURFACE_Z_M);
    expect(geometry.legs).toHaveLength(OPENARM_DEMO_TABLE_LEG_COUNT);
  });

  it("keeps the tabletop back edge clear of the OpenArm base frame", () => {
    const geometry = buildOpenArmDemoTableGeometry();

    expect(geometry.tabletopBackEdgeX).toBeCloseTo(
      OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M,
    );
  });

  it("places the tabletop five centimeters above the detected floor band", () => {
    const frame = buildFlatPointCloudFrame(
      OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT,
      OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT,
    );

    expect(resolveOpenArmDemoTableSurfaceZ([frame])).toBeCloseTo(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorSurfaceZ +
        OPENARM_DEMO_TABLE_TOP_SURFACE_ABOVE_FLOOR_M,
    );
  });

  it("uses the floor-relative table height even when no higher surface is visible", () => {
    const frame = buildFlatPointCloudFrame(
      OPENARM_DEMO_TABLE_SURFACE_MIN_SAMPLE_COUNT,
      0,
    );

    expect(resolveOpenArmDemoTableSurfaceZ([frame])).toBeCloseTo(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorSurfaceZ +
        OPENARM_DEMO_TABLE_TOP_SURFACE_ABOVE_FLOOR_M,
    );
  });

  it("keeps the table horizontal while matching the floor footprint yaw", () => {
    const pose = resolveOpenArmDemoTablePose([buildOrientedFloorPointCloudFrame()]);
    const geometry = buildOpenArmDemoTableGeometry(pose);

    expect(geometry.tabletopRotation[0]).toBe(OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD);
    expect(geometry.tabletopRotation[1]).toBe(OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD);
    expect(geometry.tabletopYawRad).toBeCloseTo(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.orientedYawRad,
    );
    expect(geometry.tabletopPosition[1]).toBeCloseTo(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.orientedCenterY,
    );
  });

  it("places the tabletop surface on the accepted calibration plane", () => {
    const pose = resolveOpenArmDemoTablePoseFromCalibrationPlanes([
      {
        center: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneCenter,
        yawRad: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneYawRad,
      },
    ]);
    const geometry = buildOpenArmDemoTableGeometry(pose ?? undefined);

    expect(geometry.tabletopSurfaceZ).toBeCloseTo(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneCenter[2],
    );
    expect(
      geometry.tabletopPosition[2] + OPENARM_DEMO_TABLE_TOP_SIZE_M.z / 2,
    ).toBeCloseTo(TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneCenter[2]);
    expect(geometry.tabletopPosition[1]).toBeCloseTo(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneCenter[1],
    );
    expect(geometry.tabletopBackEdgeX).toBeGreaterThanOrEqual(
      OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M -
        TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.backEdgeToleranceM,
    );
    expect(geometry.tabletopYawRad).toBeCloseTo(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneYawRad,
    );
  });

  it("keeps accepted calibration table poses collision-free near the robot", () => {
    const pose = resolveOpenArmDemoTablePoseFromCalibrationPlanes([
      {
        center: [
          OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M,
          TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneCenter[1],
          TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneCenter[2],
        ],
        yawRad: OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
      },
    ]);
    const geometry = buildOpenArmDemoTableGeometry(pose ?? undefined);

    expect(geometry.tabletopBackEdgeX).toBeGreaterThanOrEqual(
      OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M -
        TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.backEdgeToleranceM,
    );
  });

  it("fits accepted tabletop surface footprints inside the collision-free table", () => {
    const pose = resolveOpenArmDemoTablePoseFromCalibrationPlanes([
      {
        center: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.wideCalibrationPlaneCenter,
        size: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.wideCalibrationPlaneSize,
        yawRad: OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
      },
    ]);
    const geometry = buildOpenArmDemoTableGeometry(pose ?? undefined);

    expect(geometry.tabletopBackEdgeX).toBeGreaterThanOrEqual(
      OPENARM_DEMO_TABLE_BACK_EDGE_CLEARANCE_X_M -
        TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.backEdgeToleranceM,
    );
    for (const corner of collectTablePlaneCorners(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.wideCalibrationPlaneCenter,
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.wideCalibrationPlaneSize,
      OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
    )) {
      expectPointInsideTabletop(geometry, corner);
    }
  });

  it("bootstraps the demo table from the dominant live point-cloud surface", () => {
    const planes = resolveOpenArmDemoTableCalibrationPlanesFromPointCloudFrames([
      buildBootstrapSurfacePointCloudFrame(),
    ]);

    expect(planes).toHaveLength(1);
    expect(planes[0]?.center[2]).toBeCloseTo(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopNoiseSurfaceZ,
    );
    expect(planes[0]?.center[2]).not.toBeCloseTo(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.sparseHighSurfaceZ,
    );
    expect(planes[0]?.yawRad).toBeCloseTo(OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD);
  });

  it("fits the demo table to tabletop surface points without expanding to floor points", () => {
    const planes = resolveOpenArmDemoTableCalibrationPlanesFromPointCloudFrames([
      buildTwoLevelTabletopFootprintPointCloudFrame(),
    ]);
    const pose = resolveOpenArmDemoTablePoseFromCalibrationPlanes(planes);
    const geometry = buildOpenArmDemoTableGeometry(pose ?? undefined);

    expect(planes[0]?.surfacePoints).toHaveLength(
      TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopSurfaceFootprintPoints.length *
        TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopSurfacePointRepeats,
    );
    expect(geometry.tabletopSize[0]).toBeLessThan(OPENARM_DEMO_TABLE_TOP_SIZE_M.x);
    expect(geometry.tabletopSize[1]).toBeLessThan(OPENARM_DEMO_TABLE_TOP_SIZE_M.y);
    for (const [x, y] of TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopSurfaceFootprintPoints) {
      expectPointInsideTabletop(geometry, { x, y });
    }
    expectPointOutsideTabletop(geometry, {
      x: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorOutlierPoint[0],
      y: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.floorOutlierPoint[1],
    });
  });

  it("expands accepted calibration table poses to include current visible tabletop points", () => {
    const pose = resolveOpenArmDemoTablePoseFromCalibrationPlanesAndPointCloudFrames(
      [
        {
          center: TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneCenter,
          size: [
            TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneCenter[0],
            TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.calibrationPlaneCenter[1],
          ],
          yawRad: OPENARM_DEMO_TABLE_LEVEL_ROTATION_RAD,
        },
      ],
      [buildTwoLevelTabletopFootprintPointCloudFrame()],
    );
    const geometry = buildOpenArmDemoTableGeometry(pose ?? undefined);

    for (const [x, y] of TEST_OPENARM_DEMO_TABLE_POINT_CLOUD.tabletopSurfaceFootprintPoints) {
      expectPointInsideTabletop(geometry, { x, y });
    }
  });
});
