import * as THREE from "three";

import { buildAxisFrameBasis, getPerpendicularDirection, normalizeDirection } from "@/shared/lib/axisFrame";
import {
  THUMBNAIL_CAMERA_DISTANCE_PADDING,
  THUMBNAIL_CAMERA_FAR_DISTANCE_SCALE,
  THUMBNAIL_CAMERA_FORWARD_WEIGHT,
  THUMBNAIL_CAMERA_MIN_DISTANCE_METERS,
  THUMBNAIL_CAMERA_MIN_HALF_FOV_RADIANS,
  THUMBNAIL_CAMERA_MIN_NEAR_METERS,
  THUMBNAIL_CAMERA_NEAR_DISTANCE_DIVISOR,
  THUMBNAIL_CAMERA_SIDE_WEIGHT_MAX,
  THUMBNAIL_CAMERA_SIDE_WEIGHT_MIN,
  THUMBNAIL_CAMERA_TALLNESS_MAX,
  THUMBNAIL_CAMERA_TALLNESS_MIN,
  THUMBNAIL_CAMERA_TARGET_UP_BIAS_RATIO_MAX,
  THUMBNAIL_CAMERA_TARGET_UP_BIAS_RATIO_MIN,
  THUMBNAIL_CAMERA_UP_WEIGHT,
} from "@/features/viewer/thumbnailCameraParams";

const DEFAULT_WORLD_UP = new THREE.Vector3(0, 0, 1);
const DEFAULT_WORLD_FORWARD = new THREE.Vector3(1, 0, 0);
const BOX_CORNER_AXES = [
  [0, 0, 0],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 1],
  [1, 0, 0],
  [1, 0, 1],
  [1, 1, 0],
  [1, 1, 1],
] as const;

export type ThumbnailCameraFrame = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  near: number;
  far: number;
};

export type ThumbnailFramingObject = {
  position: THREE.Vector3;
  size: THREE.Vector3;
  isHidden?: boolean;
};

const getBoxCorners = (bounds: THREE.Box3): THREE.Vector3[] =>
  BOX_CORNER_AXES.map(
    ([xAxis, yAxis, zAxis]) =>
      new THREE.Vector3(
        xAxis === 0 ? bounds.min.x : bounds.max.x,
        yAxis === 0 ? bounds.min.y : bounds.max.y,
        zAxis === 0 ? bounds.min.z : bounds.max.z
      )
  );

const projectHalfExtent = (corners: readonly THREE.Vector3[], axis: THREE.Vector3, center: THREE.Vector3): number => {
  let maxExtent = 0;
  corners.forEach((corner) => {
    const extent = Math.abs(corner.clone().sub(center).dot(axis));
    if (extent > maxExtent) {
      maxExtent = extent;
    }
  });
  return maxExtent;
};

const clamp01 = (value: number): number => THREE.MathUtils.clamp(value, 0, 1);

export const buildThumbnailSceneBounds = ({
  robot,
  worldObjects,
}: {
  robot: THREE.Object3D;
  worldObjects: readonly ThumbnailFramingObject[];
}): THREE.Box3 => {
  robot.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(robot);
  worldObjects.forEach((object) => {
    if (object.isHidden) return;
    const halfSize = object.size.clone().multiplyScalar(0.5);
    bounds.expandByPoint(object.position.clone().sub(halfSize));
    bounds.expandByPoint(object.position.clone().add(halfSize));
  });
  return bounds;
};

export const buildThumbnailCameraFrame = ({
  bounds,
  frontWorld,
  upWorld,
  aspect,
  verticalFovDegrees,
}: {
  bounds: THREE.Box3;
  frontWorld: THREE.Vector3;
  upWorld: THREE.Vector3;
  aspect: number;
  verticalFovDegrees: number;
}): ThumbnailCameraFrame => {
  const normalizedUpWorld = normalizeDirection(upWorld, DEFAULT_WORLD_UP);
  const planarForwardWorld = normalizeDirection(
    frontWorld
      .clone()
      .addScaledVector(normalizedUpWorld, -frontWorld.dot(normalizedUpWorld)),
    getPerpendicularDirection(normalizedUpWorld, DEFAULT_WORLD_FORWARD)
  );
  const basis = buildAxisFrameBasis({
    forwardHint: planarForwardWorld,
    upHint: normalizedUpWorld,
    fallbackForward: DEFAULT_WORLD_FORWARD,
    fallbackUp: DEFAULT_WORLD_UP,
  });
  const center = bounds.getCenter(new THREE.Vector3());
  const corners = getBoxCorners(bounds);
  const halfHeight = projectHalfExtent(corners, basis.up, center);
  const halfPlanarFront = projectHalfExtent(corners, basis.forward, center);
  const halfPlanarSide = projectHalfExtent(corners, basis.right, center);
  const planarHalfExtent = Math.max(halfPlanarFront, halfPlanarSide, Number.EPSILON);
  const tallness = clamp01(
    (halfHeight / planarHalfExtent - THUMBNAIL_CAMERA_TALLNESS_MIN) /
      (THUMBNAIL_CAMERA_TALLNESS_MAX - THUMBNAIL_CAMERA_TALLNESS_MIN)
  );
  const sideWeight = THREE.MathUtils.lerp(
    THUMBNAIL_CAMERA_SIDE_WEIGHT_MAX,
    THUMBNAIL_CAMERA_SIDE_WEIGHT_MIN,
    tallness
  );
  const targetUpBias = THREE.MathUtils.lerp(
    THUMBNAIL_CAMERA_TARGET_UP_BIAS_RATIO_MIN,
    THUMBNAIL_CAMERA_TARGET_UP_BIAS_RATIO_MAX,
    tallness
  );
  const target = center.clone().addScaledVector(basis.up, halfHeight * targetUpBias);

  const viewDirection = basis.forward
    .clone()
    .multiplyScalar(THUMBNAIL_CAMERA_FORWARD_WEIGHT)
    .addScaledVector(basis.right, sideWeight)
    .addScaledVector(basis.up, THUMBNAIL_CAMERA_UP_WEIGHT)
    .normalize();
  const cameraRight = normalizeDirection(
    new THREE.Vector3().crossVectors(normalizedUpWorld, viewDirection),
    basis.right
  );
  const cameraUp = normalizeDirection(
    new THREE.Vector3().crossVectors(viewDirection, cameraRight),
    normalizedUpWorld
  );

  const verticalHalfFovRadians = Math.max(
    THUMBNAIL_CAMERA_MIN_HALF_FOV_RADIANS,
    THREE.MathUtils.degToRad(verticalFovDegrees) * 0.5
  );
  const horizontalHalfFovRadians = Math.max(
    THUMBNAIL_CAMERA_MIN_HALF_FOV_RADIANS,
    Math.atan(Math.tan(verticalHalfFovRadians) * Math.max(aspect, Number.EPSILON))
  );
  const verticalFitScale = Math.tan(verticalHalfFovRadians);
  const horizontalFitScale = Math.tan(horizontalHalfFovRadians);

  let requiredDistance = THUMBNAIL_CAMERA_MIN_DISTANCE_METERS;
  corners.forEach((corner) => {
    const relativeToTarget = corner.clone().sub(target);
    const depth = relativeToTarget.dot(viewDirection);
    const projectedRight = Math.abs(relativeToTarget.dot(cameraRight));
    const projectedUp = Math.abs(relativeToTarget.dot(cameraUp));
    requiredDistance = Math.max(
      requiredDistance,
      depth + projectedRight / Math.max(horizontalFitScale, Number.EPSILON),
      depth + projectedUp / Math.max(verticalFitScale, Number.EPSILON)
    );
  });

  const distance = Math.max(
    requiredDistance * THUMBNAIL_CAMERA_DISTANCE_PADDING,
    THUMBNAIL_CAMERA_MIN_DISTANCE_METERS
  );
  const position = target.clone().addScaledVector(viewDirection, distance);

  return {
    position,
    target,
    up: cameraUp,
    near: Math.max(distance / THUMBNAIL_CAMERA_NEAR_DISTANCE_DIVISOR, THUMBNAIL_CAMERA_MIN_NEAR_METERS),
    far: distance * THUMBNAIL_CAMERA_FAR_DISTANCE_SCALE,
  };
};
