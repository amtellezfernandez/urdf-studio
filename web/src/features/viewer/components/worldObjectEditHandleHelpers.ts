import * as THREE from "three";

import { WORLD_OBJECT_EDIT_PARAMS } from "@/features/objects/worldObjectEditParams";

export type WorldObjectEditAxis = "x" | "y" | "z";

const formatMeters = (value: number): string =>
  `${value >= 0 ? "+" : ""}${value.toFixed(WORLD_OBJECT_EDIT_PARAMS.guideMeasurementDecimals)}m`;

export const formatDegrees = (valueRad: number): string =>
  `${valueRad >= 0 ? "+" : ""}${THREE.MathUtils.radToDeg(valueRad).toFixed(1)}deg`;

export const formatAxisMeasurement = (
  axis: WorldObjectEditAxis,
  value: number
): string => `${axis.toUpperCase()} ${formatMeters(value)}`;

export const formatAxisCoordinate = (
  axis: WorldObjectEditAxis,
  value: number
): string =>
  `${axis.toUpperCase()} ${value.toFixed(WORLD_OBJECT_EDIT_PARAMS.guideMeasurementDecimals)}`;

export const formatVectorMeasurement = (
  value: THREE.Vector3,
  axes: ReadonlyArray<WorldObjectEditAxis>
): string => axes.map((axis) => formatAxisMeasurement(axis, value[axis])).join(" \u2022 ");

export const resolveHandleLabel = (handleId: string): string => {
  if (handleId.startsWith("move-")) {
    return handleId.replace("move-", "").toUpperCase();
  }
  if (handleId.startsWith("face-")) {
    const [, axis, direction] = handleId.split("-");
    return `${axis.toUpperCase()}${direction === "1" ? "+" : "-"}`;
  }
  if (handleId.startsWith("corner-")) {
    return "XYZ";
  }
  if (handleId === "resize-uniform") {
    return "XYZ";
  }
  if (handleId.startsWith("rotate-")) {
    return handleId.replace("rotate-", "").toUpperCase();
  }
  return handleId;
};

export const resolveHandleOpacity = ({
  activeHandleId,
  hoveredHandleId,
  handleId,
}: {
  activeHandleId: string | null;
  hoveredHandleId: string | null;
  handleId: string;
}) => {
  if (!activeHandleId && !hoveredHandleId) {
    return 1;
  }
  return activeHandleId === handleId || hoveredHandleId === handleId
    ? 1
    : WORLD_OBJECT_EDIT_PARAMS.inactiveHandleOpacity;
};

export const resolveHandleMaterialOpacity = ({
  activeHandleId,
  hoveredHandleId,
  handleId,
  baseOpacity = 1,
}: {
  activeHandleId: string | null;
  hoveredHandleId: string | null;
  handleId: string;
  baseOpacity?: number;
}) => {
  if (activeHandleId === handleId) {
    return baseOpacity * WORLD_OBJECT_EDIT_PARAMS.activeHandleMaterialOpacity;
  }
  if (hoveredHandleId === handleId) {
    return baseOpacity * WORLD_OBJECT_EDIT_PARAMS.hoveredHandleMaterialOpacity;
  }
  if (!activeHandleId && !hoveredHandleId) {
    return baseOpacity;
  }
  return baseOpacity * WORLD_OBJECT_EDIT_PARAMS.inactiveHandleOpacity;
};

export const buildScreenPlane = (
  camera: THREE.Camera,
  point: THREE.Vector3
): THREE.Plane => {
  const planeNormal = new THREE.Vector3();
  camera.getWorldDirection(planeNormal);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, point);
};

export const resolveWorldToScreenPoint = (
  worldPoint: THREE.Vector3,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number
): THREE.Vector2 => {
  const projected = worldPoint.clone().project(camera);
  return new THREE.Vector2(
    ((projected.x + 1) * 0.5) * viewportWidth,
    ((1 - projected.y) * 0.5) * viewportHeight
  );
};

export const resolveResizeFaceHighlightArgs = (
  size: THREE.Vector3,
  axis: WorldObjectEditAxis
): [number, number, number] => {
  if (axis === "x") {
    return [
      WORLD_OBJECT_EDIT_PARAMS.resizeFaceHighlightThicknessM,
      size.y,
      size.z,
    ];
  }
  if (axis === "y") {
    return [
      size.x,
      WORLD_OBJECT_EDIT_PARAMS.resizeFaceHighlightThicknessM,
      size.z,
    ];
  }
  return [
    size.x,
    size.y,
    WORLD_OBJECT_EDIT_PARAMS.resizeFaceHighlightThicknessM,
  ];
};

export const resolveEyeVector = (
  camera: THREE.Camera,
  worldPosition: THREE.Vector3
): THREE.Vector3 => {
  if (camera instanceof THREE.OrthographicCamera) {
    return camera.getWorldDirection(new THREE.Vector3()).negate();
  }
  return camera.position.clone().sub(worldPosition).normalize();
};

export const normalizeAngleDeltaRad = (value: number): number => {
  let normalized = value;
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
};

export const resolveAxisPlaneAngleRad = ({
  point,
  center,
  axisVector,
}: {
  point: THREE.Vector3;
  center: THREE.Vector3;
  axisVector: THREE.Vector3;
}): number => {
  const planeVector = point.clone().sub(center);
  const referenceVector =
    Math.abs(axisVector.z) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
  const basisU = referenceVector.clone().cross(axisVector).normalize();
  const basisV = axisVector.clone().cross(basisU).normalize();
  return Math.atan2(planeVector.dot(basisV), planeVector.dot(basisU));
};
