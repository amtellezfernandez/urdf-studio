import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import { computeOwnedLinkLocalVisualBounds } from "@/features/camera/cameraAutoBounds";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import { toSortedUniqueRobotMirrorLinkNames } from "@/features/layout/page/robotMirrorLinkNames";
import { ROBOT_MIRROR_SYMMETRY_PLANE_TOUCH_TOLERANCE_METERS } from "@/features/layout/page/robotMirrorSymmetryParams";

const BOX_CORNER_COMPONENTS = [0, 1] as const;

const buildLocalBoundsCorners = (bounds: THREE.Box3): THREE.Vector3[] =>
  BOX_CORNER_COMPONENTS.flatMap((xIndex) =>
    BOX_CORNER_COMPONENTS.flatMap((yIndex) =>
      BOX_CORNER_COMPONENTS.map(
        (zIndex) =>
          new THREE.Vector3(
            xIndex === 0 ? bounds.min.x : bounds.max.x,
            yIndex === 0 ? bounds.min.y : bounds.max.y,
            zIndex === 0 ? bounds.min.z : bounds.max.z
          )
      )
    )
  );

const doesLocalBoundsTouchPlane = ({
  localBounds,
  planeNormalWorld,
  planeOriginWorld,
  toleranceMeters,
  worldMatrix,
}: {
  localBounds: THREE.Box3;
  planeNormalWorld: THREE.Vector3;
  planeOriginWorld: THREE.Vector3;
  toleranceMeters: number;
  worldMatrix: THREE.Matrix4;
}): boolean => {
  let minSignedDistanceMeters = Number.POSITIVE_INFINITY;
  let maxSignedDistanceMeters = Number.NEGATIVE_INFINITY;

  buildLocalBoundsCorners(localBounds).forEach((corner) => {
    const signedDistanceMeters = corner
      .clone()
      .applyMatrix4(worldMatrix)
      .sub(planeOriginWorld)
      .dot(planeNormalWorld);
    minSignedDistanceMeters = Math.min(minSignedDistanceMeters, signedDistanceMeters);
    maxSignedDistanceMeters = Math.max(maxSignedDistanceMeters, signedDistanceMeters);
  });

  return (
    minSignedDistanceMeters <= toleranceMeters &&
    maxSignedDistanceMeters >= -toleranceMeters
  );
};

export const collectRobotMirrorPlaneTouchingLinkNamesFromBounds = ({
  check,
  linkLocalBoundsByName,
  linkWorldMatrices,
  toleranceMeters = ROBOT_MIRROR_SYMMETRY_PLANE_TOUCH_TOLERANCE_METERS,
}: {
  check: RobotMirrorSymmetryCheck | null | undefined;
  linkLocalBoundsByName: ReadonlyMap<string, THREE.Box3>;
  linkWorldMatrices: ReadonlyMap<string, THREE.Matrix4>;
  toleranceMeters?: number;
}): string[] => {
  if (!check) {
    return [];
  }

  const planeNormalWorld = new THREE.Vector3().fromArray(check.planeNormalWorld).normalize();
  const planeOriginWorld = new THREE.Vector3().fromArray(check.originMeters);
  const touchingLinkNames: string[] = [];

  linkLocalBoundsByName.forEach((localBounds, linkName) => {
    const worldMatrix = linkWorldMatrices.get(linkName) ?? null;
    if (!worldMatrix) {
      return;
    }
    if (
      doesLocalBoundsTouchPlane({
        localBounds,
        planeNormalWorld,
        planeOriginWorld,
        toleranceMeters,
        worldMatrix,
      })
    ) {
      touchingLinkNames.push(linkName);
    }
  });

  return toSortedUniqueRobotMirrorLinkNames(touchingLinkNames);
};

export const collectRobotMirrorPlaneTouchingLinkNamesFromRobot = ({
  check,
  robot,
  toleranceMeters = ROBOT_MIRROR_SYMMETRY_PLANE_TOUCH_TOLERANCE_METERS,
}: {
  check: RobotMirrorSymmetryCheck | null | undefined;
  robot: URDFRobot | null;
  toleranceMeters?: number;
}): string[] => {
  if (!check || !robot) {
    return [];
  }

  const linkLocalBoundsByName = new Map<string, THREE.Box3>();
  const linkWorldMatrices = new Map<string, THREE.Matrix4>();

  Object.entries(robot.links ?? {}).forEach(([linkName, linkObject]) => {
    const localBounds = computeOwnedLinkLocalVisualBounds(linkObject as THREE.Object3D);
    if (!localBounds) {
      return;
    }
    linkLocalBoundsByName.set(linkName, localBounds.clone());
    linkWorldMatrices.set(linkName, (linkObject as THREE.Object3D).matrixWorld.clone());
  });

  return collectRobotMirrorPlaneTouchingLinkNamesFromBounds({
    check,
    linkLocalBoundsByName,
    linkWorldMatrices,
    toleranceMeters,
  });
};
