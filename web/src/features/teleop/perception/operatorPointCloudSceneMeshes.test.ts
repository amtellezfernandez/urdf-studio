import { describe, expect, it } from "vitest";

import {
  OPERATOR_POINT_CLOUD_SCENE_MESH_FOOTPRINT_PADDING_M,
  OPERATOR_POINT_CLOUD_SCENE_MESH_HALF_EXTENT_FACTOR,
  OPERATOR_POINT_CLOUD_SCENE_MESH_MIN_SURFACE_SAMPLES,
  OPERATOR_POINT_CLOUD_SCENE_MESH_THICKNESS_M,
} from "@/features/teleop/params/operatorTeleopParams";
import {
  resolveOperatorPointCloudSceneMeshes,
  type OperatorPointCloudSceneMesh,
} from "@/features/teleop/perception/operatorPointCloudSceneMeshes";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";

const TEST_SCENE_MESH = {
  floorZ: 0,
  tableZ: 0.34,
  rawTableZOffsetM: 0.07,
  tableYawRad: Math.PI / 6,
  rawTableYawRad: -Math.PI / 5,
  sparseLiveTableRows: 2,
  sparseLiveTableColumns: 2,
  calibratedTableWidthM: 0.44,
  calibratedTableDepthM: 0.36,
  floorRows: 10,
  floorColumns: 13,
  tableRows: 10,
  tableColumns: 12,
  spacingM: 0.04,
  noiseZ: 0.7,
  sparseNoiseCount: 8,
  grayColorHex: "#666666",
  whiteColorHex: "#ffffff",
  yawPeriodRad: Math.PI,
  yawToleranceRad: 0.02,
  surfaceTopToleranceM: 1e-6,
} as const;

const TEST_INTRINSICS = {
  width: 1,
  height: 1,
  fx: 1,
  fy: 1,
  ppx: 0,
  ppy: 0,
} as const;

type TestColoredPoint = {
  point: [number, number, number];
  color: [number, number, number];
};

const buildSurfaceGrid = ({
  rows,
  columns,
  spacingM,
  z,
  yawRad,
  color,
}: {
  rows: number;
  columns: number;
  spacingM: number;
  z: number;
  yawRad: number;
  color: [number, number, number];
}): TestColoredPoint[] => {
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  const centerColumn = (columns - 1) / 2;
  const centerRow = (rows - 1) / 2;
  const points: TestColoredPoint[] = [];
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      const localX = (columnIndex - centerColumn) * spacingM;
      const localY = (rowIndex - centerRow) * spacingM;
      points.push({
        point: [
          localX * cosYaw - localY * sinYaw,
          localX * sinYaw + localY * cosYaw,
          z,
        ],
        color,
      });
    }
  }
  return points;
};

const buildPointCloudFrame = (
  coloredPoints: readonly TestColoredPoint[],
): OperatorPointCloudFrame => ({
  cameraId: "scene-camera",
  frameId: "scene-camera",
  coordinateFrame: "robot_world",
  sequence: 1,
  sourceTsMs: 1,
  intrinsics: TEST_INTRINSICS,
  pointsXyz: coloredPoints.map((entry) => entry.point),
  colorsRgb: coloredPoints.map((entry) => entry.color),
});

const normalizeYawError = (left: number, right: number): number => {
  const rawError = Math.abs(left - right) % TEST_SCENE_MESH.yawPeriodRad;
  return Math.min(rawError, TEST_SCENE_MESH.yawPeriodRad - rawError);
};

const expectMeshContainsSurface = (
  mesh: OperatorPointCloudSceneMesh,
  points: readonly TestColoredPoint[],
): void => {
  const cosYaw = Math.cos(mesh.rotationRpyRad[2]);
  const sinYaw = Math.sin(mesh.rotationRpyRad[2]);
  const halfSizeX =
    mesh.size[0] * OPERATOR_POINT_CLOUD_SCENE_MESH_HALF_EXTENT_FACTOR;
  const halfSizeY =
    mesh.size[1] * OPERATOR_POINT_CLOUD_SCENE_MESH_HALF_EXTENT_FACTOR;
  for (const entry of points) {
    const deltaX = entry.point[0] - mesh.position[0];
    const deltaY = entry.point[1] - mesh.position[1];
    const localX = deltaX * cosYaw + deltaY * sinYaw;
    const localY = -deltaX * sinYaw + deltaY * cosYaw;
    expect(Math.abs(localX)).toBeLessThanOrEqual(halfSizeX);
    expect(Math.abs(localY)).toBeLessThanOrEqual(halfSizeY);
  }
};

describe("operatorPointCloudSceneMeshes", () => {
  it("creates floor and surface meshes from dense point-cloud levels", () => {
    const floorPoints = buildSurfaceGrid({
      rows: TEST_SCENE_MESH.floorRows,
      columns: TEST_SCENE_MESH.floorColumns,
      spacingM: TEST_SCENE_MESH.spacingM,
      z: TEST_SCENE_MESH.floorZ,
      yawRad: 0,
      color: [0.4, 0.4, 0.4],
    });
    const tablePoints = buildSurfaceGrid({
      rows: TEST_SCENE_MESH.tableRows,
      columns: TEST_SCENE_MESH.tableColumns,
      spacingM: TEST_SCENE_MESH.spacingM,
      z: TEST_SCENE_MESH.tableZ,
      yawRad: TEST_SCENE_MESH.tableYawRad,
      color: [1, 1, 1],
    });
    const noisePoints = Array.from(
      { length: TEST_SCENE_MESH.sparseNoiseCount },
      (_, index): TestColoredPoint => ({
        point: [
          index * TEST_SCENE_MESH.spacingM,
          index * TEST_SCENE_MESH.spacingM,
          TEST_SCENE_MESH.noiseZ,
        ],
        color: [0, 0, 0],
      }),
    );

    const meshes = resolveOperatorPointCloudSceneMeshes([
      buildPointCloudFrame([...floorPoints, ...tablePoints, ...noisePoints]),
    ]);

    expect(meshes).toHaveLength(2);
    expect(meshes[0]).toMatchObject({
      kind: "floor",
      color: TEST_SCENE_MESH.grayColorHex,
    });
    expect(meshes[1]).toMatchObject({
      kind: "surface",
      color: TEST_SCENE_MESH.whiteColorHex,
    });
    expect(meshes[0]?.sampleCount).toBeGreaterThanOrEqual(
      OPERATOR_POINT_CLOUD_SCENE_MESH_MIN_SURFACE_SAMPLES,
    );
    expect(meshes[1]?.sampleCount).toBeGreaterThanOrEqual(
      OPERATOR_POINT_CLOUD_SCENE_MESH_MIN_SURFACE_SAMPLES,
    );
  });

  it("fits the table footprint without expanding to lower floor points", () => {
    const floorPoints = buildSurfaceGrid({
      rows: TEST_SCENE_MESH.floorRows,
      columns: TEST_SCENE_MESH.floorColumns,
      spacingM: TEST_SCENE_MESH.spacingM,
      z: TEST_SCENE_MESH.floorZ,
      yawRad: 0,
      color: [0.4, 0.4, 0.4],
    });
    const tablePoints = buildSurfaceGrid({
      rows: TEST_SCENE_MESH.tableRows,
      columns: TEST_SCENE_MESH.tableColumns,
      spacingM: TEST_SCENE_MESH.spacingM,
      z: TEST_SCENE_MESH.tableZ,
      yawRad: TEST_SCENE_MESH.tableYawRad,
      color: [1, 1, 1],
    });

    const meshes = resolveOperatorPointCloudSceneMeshes([
      buildPointCloudFrame([...floorPoints, ...tablePoints]),
    ]);
    const tableMesh = meshes.find((mesh) => mesh.kind === "surface");
    const floorMesh = meshes.find((mesh) => mesh.kind === "floor");

    expect(tableMesh).toBeDefined();
    expect(floorMesh).toBeDefined();
    expectMeshContainsSurface(tableMesh as OperatorPointCloudSceneMesh, tablePoints);
    expect(tableMesh?.size[0]).toBeLessThan(
      (floorMesh?.size[0] ?? 0) + OPERATOR_POINT_CLOUD_SCENE_MESH_FOOTPRINT_PADDING_M,
    );
    expect(
      normalizeYawError(
        tableMesh?.rotationRpyRad[2] ?? 0,
        TEST_SCENE_MESH.tableYawRad,
      ),
    ).toBeLessThan(TEST_SCENE_MESH.yawToleranceRad);
  });

  it("uses the calibration plane as the single table mesh authority", () => {
    const floorPoints = buildSurfaceGrid({
      rows: TEST_SCENE_MESH.floorRows,
      columns: TEST_SCENE_MESH.floorColumns,
      spacingM: TEST_SCENE_MESH.spacingM,
      z: TEST_SCENE_MESH.floorZ,
      yawRad: 0,
      color: [0.4, 0.4, 0.4],
    });
    const rawOffsetTablePoints = buildSurfaceGrid({
      rows: TEST_SCENE_MESH.tableRows,
      columns: TEST_SCENE_MESH.tableColumns,
      spacingM: TEST_SCENE_MESH.spacingM,
      z: TEST_SCENE_MESH.tableZ + TEST_SCENE_MESH.rawTableZOffsetM,
      yawRad: TEST_SCENE_MESH.rawTableYawRad,
      color: [1, 1, 1],
    });
    const calibratedSurfacePoints = buildSurfaceGrid({
      rows: TEST_SCENE_MESH.tableRows,
      columns: TEST_SCENE_MESH.tableColumns,
      spacingM: TEST_SCENE_MESH.spacingM,
      z: TEST_SCENE_MESH.tableZ,
      yawRad: TEST_SCENE_MESH.tableYawRad,
      color: [1, 1, 1],
    });

    const meshes = resolveOperatorPointCloudSceneMeshes(
      [buildPointCloudFrame([...floorPoints, ...rawOffsetTablePoints])],
      {},
      [{
        center: [0, 0, TEST_SCENE_MESH.tableZ],
        yawRad: TEST_SCENE_MESH.tableYawRad,
        surfacePoints: calibratedSurfacePoints.map((entry) => entry.point),
      }],
    );
    const tableMeshes = meshes.filter((mesh) => mesh.kind === "surface");
    const tableMesh = tableMeshes[0];
    const tableTopZ =
      (tableMesh?.position[2] ?? 0) +
      OPERATOR_POINT_CLOUD_SCENE_MESH_THICKNESS_M *
        OPERATOR_POINT_CLOUD_SCENE_MESH_HALF_EXTENT_FACTOR;

    expect(meshes.map((mesh) => mesh.kind)).toEqual(["floor", "surface"]);
    expect(tableMeshes).toHaveLength(1);
    expect(Math.abs(tableTopZ - TEST_SCENE_MESH.tableZ)).toBeLessThanOrEqual(
      TEST_SCENE_MESH.surfaceTopToleranceM,
    );
    expect(
      normalizeYawError(tableMesh?.rotationRpyRad[2] ?? 0, TEST_SCENE_MESH.tableYawRad),
    ).toBeLessThan(TEST_SCENE_MESH.yawToleranceRad);
  });

  it("does not let sparse same-height live points shrink the calibrated table mesh", () => {
    const sparseLiveTablePoints = buildSurfaceGrid({
      rows: TEST_SCENE_MESH.sparseLiveTableRows,
      columns: TEST_SCENE_MESH.sparseLiveTableColumns,
      spacingM: TEST_SCENE_MESH.spacingM,
      z: TEST_SCENE_MESH.tableZ,
      yawRad: TEST_SCENE_MESH.rawTableYawRad,
      color: [1, 1, 1],
    });

    const meshes = resolveOperatorPointCloudSceneMeshes(
      [buildPointCloudFrame(sparseLiveTablePoints)],
      {},
      [{
        center: [0, 0, TEST_SCENE_MESH.tableZ],
        yawRad: TEST_SCENE_MESH.tableYawRad,
        size: [
          TEST_SCENE_MESH.calibratedTableWidthM,
          TEST_SCENE_MESH.calibratedTableDepthM,
        ],
      }],
    );
    const tableMesh = meshes.find((mesh) => mesh.kind === "surface");

    expect(meshes).toHaveLength(1);
    expect(tableMesh?.position[0]).toBeCloseTo(0);
    expect(tableMesh?.position[1]).toBeCloseTo(0);
    expect(tableMesh?.size[0]).toBe(TEST_SCENE_MESH.calibratedTableWidthM);
    expect(tableMesh?.size[1]).toBe(TEST_SCENE_MESH.calibratedTableDepthM);
    expect(
      normalizeYawError(tableMesh?.rotationRpyRad[2] ?? 0, TEST_SCENE_MESH.tableYawRad),
    ).toBeLessThan(TEST_SCENE_MESH.yawToleranceRad);
  });
});
