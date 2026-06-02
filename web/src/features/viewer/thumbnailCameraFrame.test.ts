import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { buildAxisFrameBasis } from "@/shared/lib/axisFrame";
import { buildThumbnailCameraFrame } from "@/features/viewer/thumbnailCameraFrame";

const FRONT_WORLD = new THREE.Vector3(1, 0, 0);
const UP_WORLD = new THREE.Vector3(0, 0, 1);
const ASPECT_RATIO = 4 / 3;
const VERTICAL_FOV_DEGREES = 50;

const projectPointIntoNormalizedView = ({
  point,
  position,
  target,
  up,
}: {
  point: THREE.Vector3;
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
}) => {
  const viewDirection = target.clone().sub(position).normalize();
  const right = new THREE.Vector3().crossVectors(viewDirection, up).normalize();
  const resolvedUp = new THREE.Vector3().crossVectors(right, viewDirection).normalize();
  const relativeToCamera = point.clone().sub(position);
  const depth = relativeToCamera.dot(viewDirection);
  const halfVerticalFovRadians = THREE.MathUtils.degToRad(VERTICAL_FOV_DEGREES) * 0.5;
  const halfHorizontalFovRadians = Math.atan(Math.tan(halfVerticalFovRadians) * ASPECT_RATIO);
  return {
    x:
      relativeToCamera.dot(right) /
      Math.max(depth * Math.tan(halfHorizontalFovRadians), Number.EPSILON),
    y:
      relativeToCamera.dot(resolvedUp) /
      Math.max(depth * Math.tan(halfVerticalFovRadians), Number.EPSILON),
  };
};

describe("buildThumbnailCameraFrame", () => {
  it("fits every bounding-box corner inside the frame", () => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-0.28, -0.2, 0),
      new THREE.Vector3(0.42, 0.2, 1.18)
    );

    const frame = buildThumbnailCameraFrame({
      bounds,
      frontWorld: FRONT_WORLD,
      upWorld: UP_WORLD,
      aspect: ASPECT_RATIO,
      verticalFovDegrees: VERTICAL_FOV_DEGREES,
    });

    const corners = [
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
    ];

    corners.forEach((corner) => {
      const projection = projectPointIntoNormalizedView({
        point: corner,
        position: frame.position,
        target: frame.target,
        up: frame.up,
      });
      expect(Math.abs(projection.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(projection.y)).toBeLessThanOrEqual(1);
    });
  });

  it("keeps tall robots in a front-biased three-quarter view instead of a lateral diagonal", () => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-0.25, -0.18, 0),
      new THREE.Vector3(0.38, 0.18, 1.24)
    );
    const basis = buildAxisFrameBasis({
      forwardHint: FRONT_WORLD,
      upHint: UP_WORLD,
    });

    const frame = buildThumbnailCameraFrame({
      bounds,
      frontWorld: FRONT_WORLD,
      upWorld: UP_WORLD,
      aspect: ASPECT_RATIO,
      verticalFovDegrees: VERTICAL_FOV_DEGREES,
    });
    const offset = frame.position.clone().sub(frame.target);

    expect(offset.dot(basis.forward)).toBeGreaterThan(Math.abs(offset.dot(basis.right)));
  });

  it("raises the target more for tall robots than for low-profile robots", () => {
    const tallBounds = new THREE.Box3(
      new THREE.Vector3(-0.2, -0.18, 0),
      new THREE.Vector3(0.35, 0.18, 1.3)
    );
    const flatBounds = new THREE.Box3(
      new THREE.Vector3(-0.55, -0.4, 0),
      new THREE.Vector3(0.55, 0.4, 0.38)
    );

    const tallFrame = buildThumbnailCameraFrame({
      bounds: tallBounds,
      frontWorld: FRONT_WORLD,
      upWorld: UP_WORLD,
      aspect: ASPECT_RATIO,
      verticalFovDegrees: VERTICAL_FOV_DEGREES,
    });
    const flatFrame = buildThumbnailCameraFrame({
      bounds: flatBounds,
      frontWorld: FRONT_WORLD,
      upWorld: UP_WORLD,
      aspect: ASPECT_RATIO,
      verticalFovDegrees: VERTICAL_FOV_DEGREES,
    });

    const tallCenter = tallBounds.getCenter(new THREE.Vector3());
    const flatCenter = flatBounds.getCenter(new THREE.Vector3());

    expect(tallFrame.target.z - tallCenter.z).toBeGreaterThan(flatFrame.target.z - flatCenter.z);
  });
});
