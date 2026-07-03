import * as THREE from "three";

import type { RepeatedInertiaSymmetryChain } from "@/features/layout/page/repeatedInertiaSymmetry";
import type { RobotMirrorSymmetryCheck } from "@/features/layout/page/robotMirrorSymmetry";
import type { LinkObjectResolver } from "@/features/viewer/linkObjectResolver";

export const buildSimulationPrepSymmetryLinkNames = (
  chain: RepeatedInertiaSymmetryChain
): string[] =>
  Array.from(
    new Set(chain.branchLinkGroups.flatMap((branchLinkGroup) => branchLinkGroup.linkNames))
  );

export const resolveSimulationPrepSymmetryFocusRadius = ({
  chain,
  resolveLinkObject,
}: {
  chain: RepeatedInertiaSymmetryChain;
  resolveLinkObject: LinkObjectResolver;
}): number => {
  const bounds = new THREE.Box3();
  const boxCenter = new THREE.Vector3();
  const boxSize = new THREE.Vector3();
  let hasBounds = false;

  buildSimulationPrepSymmetryLinkNames(chain).forEach((linkName) => {
    const linkObject = resolveLinkObject(linkName);
    if (!linkObject) {
      return;
    }
    linkObject.updateMatrixWorld(true);
    const linkBounds = new THREE.Box3().setFromObject(linkObject);
    if (linkBounds.isEmpty()) {
      return;
    }
    if (!hasBounds) {
      bounds.copy(linkBounds);
      hasBounds = true;
      return;
    }
    bounds.union(linkBounds);
  });

  if (hasBounds) {
    bounds.getCenter(boxCenter);
    bounds.getSize(boxSize);
    return Math.max(boxSize.length() * 0.5, boxCenter.distanceTo(bounds.max));
  }

  const idealLayerRadii = chain.branchRows.flatMap((row) =>
    row.linkRows
      .map((linkRow) => linkRow.idealLayerRadiusMeters)
      .filter((radius): radius is number => radius !== null)
  );
  const candidateRadius = Math.max(
    chain.maxDistanceDeltaMeters,
    ...(chain.branchRows
      .map((row) => row.idealRadialDistanceMeters ?? row.radialDistanceMeters)
      .filter(Number.isFinite) as number[]),
    ...idealLayerRadii
  );
  return Number.isFinite(candidateRadius) ? candidateRadius : 0;
};

export const collectSimulationPrepRobotMirrorFocusLinkNames = (
  check: RobotMirrorSymmetryCheck
): string[] => (check.centeredLinkNames.length > 0 ? check.centeredLinkNames : check.supportedLinkNames);

export const resolveSimulationPrepRobotMirrorFocusRadius = ({
  check,
  resolveLinkObject,
}: {
  check: RobotMirrorSymmetryCheck;
  resolveLinkObject: LinkObjectResolver;
}): number => {
  const bounds = new THREE.Box3();
  const boxCenter = new THREE.Vector3();
  const boxSize = new THREE.Vector3();
  let hasBounds = false;

  collectSimulationPrepRobotMirrorFocusLinkNames(check).forEach((linkName) => {
    const linkObject = resolveLinkObject(linkName);
    if (!linkObject) {
      return;
    }
    linkObject.updateMatrixWorld(true);
    const linkBounds = new THREE.Box3().setFromObject(linkObject);
    if (linkBounds.isEmpty()) {
      return;
    }
    if (!hasBounds) {
      bounds.copy(linkBounds);
      hasBounds = true;
      return;
    }
    bounds.union(linkBounds);
  });

  if (hasBounds) {
    bounds.getCenter(boxCenter);
    bounds.getSize(boxSize);
    return Math.max(boxSize.length() * 0.5, boxCenter.distanceTo(bounds.max));
  }

  return check.maxResidualMeters;
};
