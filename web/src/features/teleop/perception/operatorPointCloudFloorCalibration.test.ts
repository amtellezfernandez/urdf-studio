import { describe, expect, it } from "vitest";
import {
  collectOperatorPointCloudWorldSamples,
  resolveOperatorPointCloudDominantSurfaceCalibrationResult,
  resolveOperatorPointCloudFloorCalibration,
  type OperatorPointCloudWorldSample,
} from "@/features/teleop/perception/operatorPointCloudFloorCalibration";
import {
  buildOperatorPointCloudPoseTransform,
} from "@/features/teleop/perception/operatorPointCloudPose";
import {
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
  OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MIN_FLOOR_SAMPLES,
} from "@/features/teleop/params/operatorTeleopParams";

const TEST_POINT_CLOUD_FLOOR_CALIBRATION = {
  slopeX: 0.02,
  sampleSpacingM: 0.01,
  rowPeriod: 2,
  floorZ: 0,
  dominantSurfaceZ: 0.2,
  dominantSurfaceSampleMultiplier: 3,
  sparseFloorSampleCount: 6,
  expectedLevelNormalZ: 1,
  rawDepthMm: 320,
  depthScaleM: 0.001,
  orientedYawRad: Math.PI / 6,
  orientedColumnCount: 8,
  orientedRowCount: 4,
  orientedSpacingM: 0.02,
} as const;

const buildInclinedFloorSamples = (
  sampleCount = OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MIN_FLOOR_SAMPLES,
): OperatorPointCloudWorldSample[] =>
  Array.from(
    { length: sampleCount },
    (_, index) => {
      const x = index * TEST_POINT_CLOUD_FLOOR_CALIBRATION.sampleSpacingM;
      const y =
        (index % TEST_POINT_CLOUD_FLOOR_CALIBRATION.rowPeriod) *
        TEST_POINT_CLOUD_FLOOR_CALIBRATION.sampleSpacingM;
      const z =
        TEST_POINT_CLOUD_FLOOR_CALIBRATION.floorZ +
        x * TEST_POINT_CLOUD_FLOOR_CALIBRATION.slopeX;
      return {
        binKey: Math.round(
          z / OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
        ),
        x,
        y,
        z,
      };
    },
  );

const buildOrientedSurfaceSamples = (): OperatorPointCloudWorldSample[] => {
  const samples: OperatorPointCloudWorldSample[] = [];
  const cosYaw = Math.cos(TEST_POINT_CLOUD_FLOOR_CALIBRATION.orientedYawRad);
  const sinYaw = Math.sin(TEST_POINT_CLOUD_FLOOR_CALIBRATION.orientedYawRad);
  for (
    let rowIndex = 0;
    rowIndex < TEST_POINT_CLOUD_FLOOR_CALIBRATION.orientedRowCount;
    rowIndex += 1
  ) {
    for (
      let columnIndex = 0;
      columnIndex < TEST_POINT_CLOUD_FLOOR_CALIBRATION.orientedColumnCount;
      columnIndex += 1
    ) {
      const localX =
        columnIndex * TEST_POINT_CLOUD_FLOOR_CALIBRATION.orientedSpacingM;
      const localY =
        rowIndex * TEST_POINT_CLOUD_FLOOR_CALIBRATION.orientedSpacingM;
      const x = localX * cosYaw - localY * sinYaw;
      const y = localX * sinYaw + localY * cosYaw;
      samples.push({
        binKey: Math.round(
          TEST_POINT_CLOUD_FLOOR_CALIBRATION.dominantSurfaceZ /
            OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
        ),
        x,
        y,
        z: TEST_POINT_CLOUD_FLOOR_CALIBRATION.dominantSurfaceZ,
      });
    }
  }
  return samples;
};

describe("operatorPointCloudFloorCalibration", () => {
  it("estimates a leveling correction from an inclined floor plane", () => {
    const calibration = resolveOperatorPointCloudFloorCalibration(
      buildInclinedFloorSamples(),
    );

    expect(calibration).not.toBeNull();
    expect(calibration?.correctionAngleRad).toBeGreaterThan(0);
    expect(calibration?.normal[2]).toBeLessThan(
      TEST_POINT_CLOUD_FLOOR_CALIBRATION.expectedLevelNormalZ,
    );
  });

  it("builds a visual plane from the dominant dense surface", () => {
    const denseTableSamples = buildInclinedFloorSamples(
      OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MIN_FLOOR_SAMPLES *
        TEST_POINT_CLOUD_FLOOR_CALIBRATION.dominantSurfaceSampleMultiplier,
    ).map((sample) => ({
      ...sample,
      z: sample.z + TEST_POINT_CLOUD_FLOOR_CALIBRATION.dominantSurfaceZ,
      binKey: Math.round(
        (sample.z + TEST_POINT_CLOUD_FLOOR_CALIBRATION.dominantSurfaceZ) /
          OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
      ),
    }));
    const sparseFloorSamples = denseTableSamples
      .slice(0, TEST_POINT_CLOUD_FLOOR_CALIBRATION.sparseFloorSampleCount)
      .map((sample) => ({
        ...sample,
        z: TEST_POINT_CLOUD_FLOOR_CALIBRATION.floorZ,
        binKey: Math.round(
          TEST_POINT_CLOUD_FLOOR_CALIBRATION.floorZ /
            OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_HEIGHT_BIN_SIZE_M,
        ),
      }));

    const result = resolveOperatorPointCloudDominantSurfaceCalibrationResult([
      ...sparseFloorSamples,
      ...denseTableSamples,
    ]);

    expect(result).not.toBeNull();
    expect(result?.plane.center[2]).toBeGreaterThan(
      TEST_POINT_CLOUD_FLOOR_CALIBRATION.floorZ,
    );
    expect(result?.plane.sampleCount).toBeGreaterThanOrEqual(
      OPERATOR_POINT_CLOUD_LEVEL_CALIBRATION_MIN_FLOOR_SAMPLES,
    );
  });

  it("uses camera pose scale before fitting world point heights", () => {
    const samples = collectOperatorPointCloudWorldSamples(
      {
        cameraId: "scaled-depth-camera",
        frameId: "scaled-depth-camera",
        coordinateFrame: "camera",
        sequence: 1,
        sourceTsMs: 1,
        intrinsics: {
          width: 1,
          height: 1,
          fx: 1,
          fy: 1,
          ppx: 0,
          ppy: 0,
        },
        pointsXyz: [],
        colorsRgb: [],
        pointsXyzFlat: new Float32Array([
          0,
          0,
          TEST_POINT_CLOUD_FLOOR_CALIBRATION.rawDepthMm,
        ]),
        colorsRgbFlat: new Float32Array([1, 1, 1]),
        pointCount: 1,
      },
      buildOperatorPointCloudPoseTransform({
        position: [0, 0, 0],
        rotationRpyDeg: [0, 0, 0],
        scale: TEST_POINT_CLOUD_FLOOR_CALIBRATION.depthScaleM,
        worldFrame: "urdf_z_up",
      }),
    );

    expect(samples[0]?.z).toBeCloseTo(
      TEST_POINT_CLOUD_FLOOR_CALIBRATION.rawDepthMm *
        TEST_POINT_CLOUD_FLOOR_CALIBRATION.depthScaleM,
    );
  });

  it("fits the visible surface border yaw", () => {
    const result = resolveOperatorPointCloudDominantSurfaceCalibrationResult(
      buildOrientedSurfaceSamples(),
    );

    expect(result?.plane.yawRad).toBeCloseTo(
      TEST_POINT_CLOUD_FLOOR_CALIBRATION.orientedYawRad,
    );
  });
});
