import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  applyOperatorPointCloudGeometryFrame,
  buildOperatorPointCloudGeometryAttributes,
} from "@/features/teleop/perception/operatorPointCloud";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";

const TEST_POINT_CLOUD_FIXTURE = {
  sequence: 1,
  sourceTsMs: 2,
  cameraWidthPx: 2,
  cameraHeightPx: 1,
  cameraFocalPx: 1,
  cameraPrincipalPointPx: 1,
  positions: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  colors: [1, 0, 0, 0, 1, 0],
} as const;
const TEST_FLAT_POINT_COUNT = 1;

const TEST_POINT_CLOUD_FRAME: OperatorPointCloudFrame = {
  cameraId: "openarm_depth_camera",
  frameId: "openarm_depth_camera",
  coordinateFrame: "robot_world",
  sequence: TEST_POINT_CLOUD_FIXTURE.sequence,
  sourceTsMs: TEST_POINT_CLOUD_FIXTURE.sourceTsMs,
  intrinsics: {
    width: TEST_POINT_CLOUD_FIXTURE.cameraWidthPx,
    height: TEST_POINT_CLOUD_FIXTURE.cameraHeightPx,
    fx: TEST_POINT_CLOUD_FIXTURE.cameraFocalPx,
    fy: TEST_POINT_CLOUD_FIXTURE.cameraFocalPx,
    ppx: TEST_POINT_CLOUD_FIXTURE.cameraPrincipalPointPx,
    ppy: TEST_POINT_CLOUD_FIXTURE.cameraPrincipalPointPx,
  },
  pointsXyz: [
    [
      TEST_POINT_CLOUD_FIXTURE.positions[0],
      TEST_POINT_CLOUD_FIXTURE.positions[1],
      TEST_POINT_CLOUD_FIXTURE.positions[2],
    ],
    [
      TEST_POINT_CLOUD_FIXTURE.positions[3],
      TEST_POINT_CLOUD_FIXTURE.positions[4],
      TEST_POINT_CLOUD_FIXTURE.positions[5],
    ],
  ],
  colorsRgb: [
    [
      TEST_POINT_CLOUD_FIXTURE.colors[0],
      TEST_POINT_CLOUD_FIXTURE.colors[1],
      TEST_POINT_CLOUD_FIXTURE.colors[2],
    ],
    [
      TEST_POINT_CLOUD_FIXTURE.colors[3],
      TEST_POINT_CLOUD_FIXTURE.colors[4],
      TEST_POINT_CLOUD_FIXTURE.colors[5],
    ],
  ],
};

describe("operatorPointCloud", () => {
  it("packs point-cloud coordinates and camera colors for Three.js", () => {
    const attributes = buildOperatorPointCloudGeometryAttributes(
      TEST_POINT_CLOUD_FRAME,
    );

    expect(attributes.pointCount).toBe(TEST_POINT_CLOUD_FRAME.pointsXyz.length);
    expect(Array.from(attributes.positions)).toEqual(
      TEST_POINT_CLOUD_FIXTURE.positions.map((position) =>
        expect.closeTo(position),
      ),
    );
    expect(Array.from(attributes.colors)).toEqual(
      TEST_POINT_CLOUD_FIXTURE.colors.map((color) => expect.closeTo(color)),
    );
  });

  it("reuses flat live point-cloud buffers without repacking", () => {
    const positions = new Float32Array(TEST_POINT_CLOUD_FIXTURE.positions);
    const colors = new Float32Array(TEST_POINT_CLOUD_FIXTURE.colors);

    const attributes = buildOperatorPointCloudGeometryAttributes({
      ...TEST_POINT_CLOUD_FRAME,
      pointsXyz: [],
      colorsRgb: [],
      pointsXyzFlat: positions,
      colorsRgbFlat: colors,
      pointCount: TEST_FLAT_POINT_COUNT,
    });

    expect(attributes.positions).toBe(positions);
    expect(attributes.colors).toBe(colors);
    expect(attributes.pointCount).toBe(TEST_FLAT_POINT_COUNT);
  });

  it("updates stable Three.js geometry buffers in place", () => {
    const geometry = new THREE.BufferGeometry();
    const firstAttributes = applyOperatorPointCloudGeometryFrame(
      geometry,
      TEST_POINT_CLOUD_FRAME,
    );
    const positionAttribute = geometry.getAttribute("position");
    const colorAttribute = geometry.getAttribute("color");
    const nextPositions = TEST_POINT_CLOUD_FIXTURE.positions.map(
      (position) => position + TEST_POINT_CLOUD_FIXTURE.sequence,
    );

    const nextAttributes = applyOperatorPointCloudGeometryFrame(geometry, {
      ...TEST_POINT_CLOUD_FRAME,
      pointsXyzFlat: new Float32Array(nextPositions),
      colorsRgbFlat: firstAttributes.colors,
      pointCount: TEST_POINT_CLOUD_FRAME.pointsXyz.length,
    });

    expect(nextAttributes.pointCount).toBe(
      TEST_POINT_CLOUD_FRAME.pointsXyz.length,
    );
    expect(geometry.getAttribute("position")).toBe(positionAttribute);
    expect(geometry.getAttribute("color")).toBe(colorAttribute);
    expect(Array.from(positionAttribute.array)).toEqual(
      nextPositions.map((position) => expect.closeTo(position)),
    );

    geometry.dispose();
  });

  it("keeps existing Three.js buffers when a live frame has fewer points", () => {
    const geometry = new THREE.BufferGeometry();
    applyOperatorPointCloudGeometryFrame(geometry, TEST_POINT_CLOUD_FRAME);
    const positionAttribute = geometry.getAttribute("position");
    const colorAttribute = geometry.getAttribute("color");
    const nextPositions = TEST_POINT_CLOUD_FIXTURE.positions.slice(
      0,
      TEST_POINT_CLOUD_FIXTURE.positions.length / TEST_POINT_CLOUD_FRAME.pointsXyz.length,
    );
    const nextColors = TEST_POINT_CLOUD_FIXTURE.colors.slice(
      0,
      TEST_POINT_CLOUD_FIXTURE.colors.length / TEST_POINT_CLOUD_FRAME.colorsRgb.length,
    );

    const nextAttributes = applyOperatorPointCloudGeometryFrame(geometry, {
      ...TEST_POINT_CLOUD_FRAME,
      pointsXyz: [],
      colorsRgb: [],
      pointsXyzFlat: new Float32Array(nextPositions),
      colorsRgbFlat: new Float32Array(nextColors),
      pointCount: TEST_FLAT_POINT_COUNT,
    });

    expect(nextAttributes.pointCount).toBe(TEST_FLAT_POINT_COUNT);
    expect(geometry.getAttribute("position")).toBe(positionAttribute);
    expect(geometry.getAttribute("color")).toBe(colorAttribute);
    expect(geometry.drawRange.count).toBe(TEST_FLAT_POINT_COUNT);
    expect(
      Array.from(
        positionAttribute.array.slice(0, nextAttributes.positions.length),
      ),
    ).toEqual(nextPositions.map((position) => expect.closeTo(position)));
    expect(
      Array.from(colorAttribute.array.slice(0, nextAttributes.colors.length)),
    ).toEqual(nextColors.map((color) => expect.closeTo(color)));

    geometry.dispose();
  });
});
