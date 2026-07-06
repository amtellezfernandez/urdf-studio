import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import {
  createIdentityRigidFrame,
  localToWorldPositionInFrame,
  localToWorldQuaternionInFrame,
  updateRigidFrameFromMatrixWorld,
  worldToLocalPositionInFrame,
  worldToLocalQuaternionInFrame,
} from "@/shared/lib/spatialFrame";
import type { DragRuntimeCache } from "./types";
import { safeDecodeURIComponent } from "@/features/viewer/uri";

export { safeDecodeURIComponent };

export const createEmptyDragRuntimeCache = (): DragRuntimeCache => ({
  chainJointNames: null,
  baseLinkName: null,
  reachRadius: null,
  robotWorldFrame: createIdentityRigidFrame(),
});

export const refreshRobotFrameCache = (cache: DragRuntimeCache, robot: URDFRobot | null) => {
  if (!robot) {
    cache.robotWorldFrame.position.set(0, 0, 0);
    cache.robotWorldFrame.quaternion.set(0, 0, 0, 1);
    cache.robotWorldFrame.inverseQuaternion.set(0, 0, 0, 1);
    return;
  }
  robot.updateMatrixWorld(true);
  updateRigidFrameFromMatrixWorld(robot.matrixWorld, cache.robotWorldFrame);
};

export const worldToRobotPosition = (
  cache: DragRuntimeCache,
  worldPosition: THREE.Vector3,
  out: THREE.Vector3
): THREE.Vector3 => worldToLocalPositionInFrame(cache.robotWorldFrame, worldPosition, out);

export const robotToWorldPosition = (
  cache: DragRuntimeCache,
  localPosition: THREE.Vector3,
  out: THREE.Vector3
): THREE.Vector3 => localToWorldPositionInFrame(cache.robotWorldFrame, localPosition, out);

export const worldToRobotQuaternion = (
  cache: DragRuntimeCache,
  worldQuaternion: THREE.Quaternion,
  out: THREE.Quaternion
) => worldToLocalQuaternionInFrame(cache.robotWorldFrame, worldQuaternion, out);

export const robotToWorldQuaternion = (
  cache: DragRuntimeCache,
  localQuaternion: THREE.Quaternion,
  out: THREE.Quaternion
) => localToWorldQuaternionInFrame(cache.robotWorldFrame, localQuaternion, out);

export const buildChainJointNamesFromAnalysis = (
  urdfAnalysis: UrdfAnalysis | null,
  endEffectorLink: string,
  maxLinkTraversal: number
): Set<string> | null => {
  if (!urdfAnalysis?.isValid || !endEffectorLink) return null;
  const targetLink = safeDecodeURIComponent(endEffectorLink);
  const childToJointName = new Map<string, string>();
  for (const joint of urdfAnalysis.jointHierarchy.orderedJoints) {
    if (!joint?.childLink || !joint?.jointName) continue;
    childToJointName.set(joint.childLink, joint.jointName);
  }

  const chain = new Set<string>();
  let cursor = targetLink;
  let traversed = 0;
  while (traversed < maxLinkTraversal) {
    const jointInfo = urdfAnalysis.jointByChildLink[cursor];
    if (!jointInfo) break;
    const jointName = childToJointName.get(cursor);
    if (jointName) {
      chain.add(jointName);
    }
    cursor = jointInfo.parentLink;
    traversed += 1;
  }
  return chain.size > 0 ? chain : null;
};

type ResolveReachRadiusParams = {
  urdfAnalysis: UrdfAnalysis | null;
  endEffectorLink: string;
  robot: URDFRobot | null;
  maxLinkTraversal: number;
  reachMargin: number;
  minReachMargin: number;
  reachSlackMeters: number;
  dynamicHeadroomMeters: number;
};

export const resolveReachRadiusFromAnalysis = ({
  urdfAnalysis,
  endEffectorLink,
  robot,
  maxLinkTraversal,
  reachMargin,
  minReachMargin,
  reachSlackMeters,
  dynamicHeadroomMeters,
}: ResolveReachRadiusParams): { baseLinkName: string | null; reachRadius: number | null } => {
  if (!urdfAnalysis?.isValid || !endEffectorLink) {
    return { baseLinkName: null, reachRadius: null };
  }

  try {
    const jointByChildLink = urdfAnalysis.jointByChildLink;
    let reach = 0;
    let cursor = endEffectorLink;
    let traversed = 0;
    while (jointByChildLink[cursor] && traversed < maxLinkTraversal) {
      const jointInfo = jointByChildLink[cursor];
      if (!jointInfo) break;
      const [x, y, z] = jointInfo.origin;
      reach += Math.sqrt(x * x + y * y + z * z);
      if (jointInfo.type === "prismatic") {
        const lower = jointInfo.limitLower ?? 0;
        const upper = jointInfo.limitUpper ?? 0;
        reach += Math.max(Math.abs(lower), Math.abs(upper));
      }
      cursor = jointInfo.parentLink;
      traversed += 1;
    }

    const effectiveMargin = Math.max(reachMargin, minReachMargin);
    let reachRadius = reach > 0 ? reach * effectiveMargin + reachSlackMeters : null;
    let baseLinkName = cursor || null;
    if (!baseLinkName) {
      baseLinkName = urdfAnalysis.rootLinks[0] ?? null;
    }

    if (reachRadius && robot) {
      const baseObject =
        (baseLinkName &&
          (robot.links?.[baseLinkName] ?? robot.getObjectByName?.(baseLinkName))) ||
        robot;
      const eeObject =
        robot.links?.[endEffectorLink] ??
        robot.getObjectByName?.(endEffectorLink) ??
        robot.getObjectByName?.(safeDecodeURIComponent(endEffectorLink));
      if (baseObject && eeObject) {
        baseObject.updateMatrixWorld(true);
        eeObject.updateMatrixWorld(true);
        const basePosition = new THREE.Vector3();
        const eePosition = new THREE.Vector3();
        baseObject.getWorldPosition(basePosition);
        eeObject.getWorldPosition(eePosition);
        const currentDistance = basePosition.distanceTo(eePosition);
        reachRadius = Math.max(reachRadius, currentDistance + dynamicHeadroomMeters);
      }
    }
    return { baseLinkName, reachRadius };
  } catch {
    return { baseLinkName: null, reachRadius: null };
  }
};
