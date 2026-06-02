import * as THREE from "three";

import {
  OPERATOR_POINT_CLOUD_COLOR_COMPONENTS,
  OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorPointCloudFrame } from "@/features/teleop/transport/operatorHelperApi";

const POINT_CLOUD_COMPONENT_INDEX = {
  x: 0,
  y: 1,
  z: 2,
  red: 0,
  green: 1,
  blue: 2,
} as const;

export type OperatorPointCloudGeometryAttributes = {
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
};

export const getOperatorPointCloudPointCount = (
  frame: OperatorPointCloudFrame,
): number =>
  frame.pointCount ??
  (frame.pointsXyzFlat
    ? Math.floor(
        frame.pointsXyzFlat.length / OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS,
      )
    : frame.pointsXyz.length);

export const readOperatorPointCloudLocalPoint = (
  frame: OperatorPointCloudFrame,
  pointIndex: number,
  target: THREE.Vector3,
): THREE.Vector3 | null => {
  if (frame.pointsXyzFlat) {
    const offset = pointIndex * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS;
    const zOffset = offset + POINT_CLOUD_COMPONENT_INDEX.z;
    if (zOffset >= frame.pointsXyzFlat.length) return null;
    return target.set(
      frame.pointsXyzFlat[offset + POINT_CLOUD_COMPONENT_INDEX.x],
      frame.pointsXyzFlat[offset + POINT_CLOUD_COMPONENT_INDEX.y],
      frame.pointsXyzFlat[zOffset],
    );
  }

  const point = frame.pointsXyz[pointIndex];
  return point
    ? target.set(
        point[POINT_CLOUD_COMPONENT_INDEX.x],
        point[POINT_CLOUD_COMPONENT_INDEX.y],
        point[POINT_CLOUD_COMPONENT_INDEX.z],
      )
    : null;
};

export const buildOperatorPointCloudGeometryAttributes = (
  frame: OperatorPointCloudFrame,
): OperatorPointCloudGeometryAttributes => {
  if (
    frame.pointsXyzFlat &&
    frame.colorsRgbFlat &&
    typeof frame.pointCount === "number"
  ) {
    return {
      positions: frame.pointsXyzFlat,
      colors: frame.colorsRgbFlat,
      pointCount: frame.pointCount,
    };
  }

  const pointCount = Math.min(frame.pointsXyz.length, frame.colorsRgb.length);
  const positions = new Float32Array(
    pointCount * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS,
  );
  const colors = new Float32Array(
    pointCount * OPERATOR_POINT_CLOUD_COLOR_COMPONENTS,
  );
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const positionOffset =
      pointIndex * OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS;
    const colorOffset = pointIndex * OPERATOR_POINT_CLOUD_COLOR_COMPONENTS;
    const point = frame.pointsXyz[pointIndex];
    const color = frame.colorsRgb[pointIndex];
    positions[positionOffset + POINT_CLOUD_COMPONENT_INDEX.x] =
      point[POINT_CLOUD_COMPONENT_INDEX.x];
    positions[positionOffset + POINT_CLOUD_COMPONENT_INDEX.y] =
      point[POINT_CLOUD_COMPONENT_INDEX.y];
    positions[positionOffset + POINT_CLOUD_COMPONENT_INDEX.z] =
      point[POINT_CLOUD_COMPONENT_INDEX.z];
    colors[colorOffset + POINT_CLOUD_COMPONENT_INDEX.red] =
      color[POINT_CLOUD_COMPONENT_INDEX.red];
    colors[colorOffset + POINT_CLOUD_COMPONENT_INDEX.green] =
      color[POINT_CLOUD_COMPONENT_INDEX.green];
    colors[colorOffset + POINT_CLOUD_COMPONENT_INDEX.blue] =
      color[POINT_CLOUD_COMPONENT_INDEX.blue];
  }
  return { positions, colors, pointCount };
};

const updateOperatorPointCloudBufferAttribute = (
  geometry: THREE.BufferGeometry,
  name: string,
  values: Float32Array,
  itemSize: number,
): void => {
  const currentAttribute = geometry.getAttribute(name);
  if (
    currentAttribute instanceof THREE.BufferAttribute &&
    currentAttribute.itemSize === itemSize &&
    currentAttribute.array instanceof Float32Array
  ) {
    if (currentAttribute.array.length >= values.length) {
      currentAttribute.array.set(values);
      currentAttribute.needsUpdate = true;
      return;
    }
  }
  geometry.setAttribute(name, new THREE.BufferAttribute(values, itemSize));
};

export const applyOperatorPointCloudGeometryFrame = (
  geometry: THREE.BufferGeometry,
  frame: OperatorPointCloudFrame,
): OperatorPointCloudGeometryAttributes => {
  const attributes = buildOperatorPointCloudGeometryAttributes(frame);
  updateOperatorPointCloudBufferAttribute(
    geometry,
    "position",
    attributes.positions,
    OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS,
  );
  updateOperatorPointCloudBufferAttribute(
    geometry,
    "color",
    attributes.colors,
    OPERATOR_POINT_CLOUD_COLOR_COMPONENTS,
  );
  geometry.setDrawRange(0, attributes.pointCount);
  return attributes;
};
