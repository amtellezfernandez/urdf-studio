import * as THREE from "three";
import { isFiniteNumber } from "@/shared/lib/numeric";
import { WORLD_OBJECT_GEOMETRY_PARAMS } from "./worldObjectGeometryParams";

const HALF_EXTENT_SCALE = 0.5;

export const WORLD_OBJECT_CUBE_CORNER_SIGNS = [
  new THREE.Vector3(-1, -1, -1),
  new THREE.Vector3(-1, -1, 1),
  new THREE.Vector3(-1, 1, -1),
  new THREE.Vector3(-1, 1, 1),
  new THREE.Vector3(1, -1, -1),
  new THREE.Vector3(1, -1, 1),
  new THREE.Vector3(1, 1, -1),
  new THREE.Vector3(1, 1, 1),
] as const;

export const WORLD_OBJECT_CUBE_FACE_HANDLES = [
  { axis: "x", direction: -1 },
  { axis: "x", direction: 1 },
  { axis: "y", direction: -1 },
  { axis: "y", direction: 1 },
  { axis: "z", direction: -1 },
  { axis: "z", direction: 1 },
] as const;

export const resolveCubeCornerPosition = (
  center: THREE.Vector3,
  size: THREE.Vector3,
  sign: THREE.Vector3
): THREE.Vector3 =>
  new THREE.Vector3(
    center.x + sign.x * size.x * HALF_EXTENT_SCALE,
    center.y + sign.y * size.y * HALF_EXTENT_SCALE,
    center.z + sign.z * size.z * HALF_EXTENT_SCALE
  );

export const resolveCubeCornerOffset = (
  size: THREE.Vector3,
  sign: THREE.Vector3
): THREE.Vector3 =>
  new THREE.Vector3(
    sign.x * size.x * HALF_EXTENT_SCALE,
    sign.y * size.y * HALF_EXTENT_SCALE,
    sign.z * size.z * HALF_EXTENT_SCALE
  );

export const resolveWorldCubeCornerPosition = ({
  center,
  size,
  rotation,
  sign,
}: {
  center: THREE.Vector3;
  size: THREE.Vector3;
  rotation: THREE.Euler | THREE.Quaternion;
  sign: THREE.Vector3;
}): THREE.Vector3 => {
  const quaternion =
    rotation instanceof THREE.Quaternion ? rotation : new THREE.Quaternion().setFromEuler(rotation);
  return center.clone().add(resolveCubeCornerOffset(size, sign).applyQuaternion(quaternion));
};

export const resolveCubeResizeFromDraggedCorner = ({
  anchorCorner,
  draggedCorner,
  handleSign,
}: {
  anchorCorner: THREE.Vector3;
  draggedCorner: THREE.Vector3;
  handleSign: THREE.Vector3;
}): {
  position: THREE.Vector3;
  size: THREE.Vector3;
} => {
  const extentX = Math.max(
    WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM,
    (draggedCorner.x - anchorCorner.x) * handleSign.x
  );
  const extentY = Math.max(
    WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM,
    (draggedCorner.y - anchorCorner.y) * handleSign.y
  );
  const extentZ = Math.max(
    WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM,
    (draggedCorner.z - anchorCorner.z) * handleSign.z
  );

  const resolvedDraggedCorner = new THREE.Vector3(
    anchorCorner.x + handleSign.x * extentX,
    anchorCorner.y + handleSign.y * extentY,
    anchorCorner.z + handleSign.z * extentZ
  );

  return {
    position: anchorCorner.clone().add(resolvedDraggedCorner).multiplyScalar(HALF_EXTENT_SCALE),
    size: new THREE.Vector3(extentX, extentY, extentZ),
  };
};

export const resolveCubeFaceHandlePosition = ({
  center,
  size,
  axis,
  direction,
}: {
  center: THREE.Vector3;
  size: THREE.Vector3;
  axis: "x" | "y" | "z";
  direction: -1 | 1;
}): THREE.Vector3 => {
  const position = center.clone();
  const halfExtent =
    axis === "x"
      ? size.x * HALF_EXTENT_SCALE
      : axis === "y"
        ? size.y * HALF_EXTENT_SCALE
        : size.z * HALF_EXTENT_SCALE;
  position[axis] += halfExtent * direction;
  return position;
};

export const resolveWorldCubeFaceHandlePosition = ({
  center,
  size,
  rotation,
  axis,
  direction,
}: {
  center: THREE.Vector3;
  size: THREE.Vector3;
  rotation: THREE.Euler | THREE.Quaternion;
  axis: "x" | "y" | "z";
  direction: -1 | 1;
}): THREE.Vector3 => {
  const quaternion =
    rotation instanceof THREE.Quaternion ? rotation : new THREE.Quaternion().setFromEuler(rotation);
  const localPosition = resolveCubeFaceHandlePosition({
    center: new THREE.Vector3(0, 0, 0),
    size,
    axis,
    direction,
  });
  return center.clone().add(localPosition.applyQuaternion(quaternion));
};

export const resolveCubeResizeFromDraggedFace = ({
  position,
  size,
  axis,
  direction,
  axisDelta,
}: {
  position: THREE.Vector3;
  size: THREE.Vector3;
  axis: "x" | "y" | "z";
  direction: -1 | 1;
  axisDelta: number;
}): {
  position: THREE.Vector3;
  size: THREE.Vector3;
} => {
  const nextPosition = position.clone();
  const nextSize = size.clone();
  const currentExtent = size[axis];
  const clampedExtent = Math.max(
    WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM,
    currentExtent + axisDelta
  );
  const resolvedDelta = clampedExtent - currentExtent;
  nextSize[axis] = clampedExtent;
  nextPosition[axis] += resolvedDelta * HALF_EXTENT_SCALE * direction;
  return {
    position: nextPosition,
    size: nextSize,
  };
};

export const resolveCubeUniformResize = ({
  position,
  size,
  sizeDelta,
}: {
  position: THREE.Vector3;
  size: THREE.Vector3;
  sizeDelta: number;
}): {
  position: THREE.Vector3;
  size: THREE.Vector3;
} => ({
  position: position.clone(),
  size: new THREE.Vector3(
    Math.max(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM, size.x + sizeDelta),
    Math.max(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM, size.y + sizeDelta),
    Math.max(WORLD_OBJECT_GEOMETRY_PARAMS.cubeMinSizeM, size.z + sizeDelta)
  ),
});

export const snapScalar = (value: number, step: number): number => {
  if (!isFiniteNumber(value) || !isFiniteNumber(step) || step <= 0) {
    return value;
  }
  const snapped = Math.round(value / step) * step;
  return Object.is(snapped, -0) ? 0 : snapped;
};

export const snapVector3 = (
  value: THREE.Vector3,
  step: number,
  enabled = true
): THREE.Vector3 =>
  enabled
    ? new THREE.Vector3(
        snapScalar(value.x, step),
        snapScalar(value.y, step),
        snapScalar(value.z, step)
      )
    : value.clone();

export const snapVector3OnAxes = (
  value: THREE.Vector3,
  step: number,
  axes: ReadonlyArray<"x" | "y" | "z">,
  enabled = true
): THREE.Vector3 => {
  if (!enabled) {
    return value.clone();
  }
  const snapped = value.clone();
  axes.forEach((axis) => {
    snapped[axis] = snapScalar(snapped[axis], step);
  });
  return snapped;
};
