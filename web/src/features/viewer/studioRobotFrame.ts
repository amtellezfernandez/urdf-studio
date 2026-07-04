import * as THREE from "three";
import type { URDFJoint, URDFRobot } from "urdf-loader";

import {
  getCameraWorldPose,
  resolveCameraParentLinkNameFromJoint,
} from "@/features/camera/cameraWorldPose";
import { computeOwnedLinkLocalVisualCentroid } from "@/features/camera/cameraAutoBounds";
import {
  getPerpendicularDirection as getPerpendicularDirectionFromContract,
  localDirectionFromWorld,
  projectDirectionOntoPlane,
  projectVectorOntoPlane as projectVectorOntoPlaneFromContract,
} from "@/shared/lib/axisFrame";
import type { Camera as RobotCamera } from "@/shared/types/camera";
import {
  enforcePlanarBasePose,
  FLAT_GROUND_HEIGHT_FN,
  type PlanarClampResult,
} from "@/features/locomotion/safety/planarClamp";

const STUDIO_WORLD_UP_AXIS = new THREE.Vector3(0, 0, 1);
export const ROBOT_FRONT_LOCAL_FORWARD = new THREE.Vector3(1, 0, 0);

const DOMINANT_AXIS_THRESHOLD = 0.9;
const STUDIO_PLANAR_EPSILON = 1e-6;
const ROBOT_FRONT_CAMERA_DIRECTION_EPSILON = 1e-10;
const CAMERA_LIKE_LINK_NAME_PATTERN = /(camera|cam)/i;
const ROBOT_FRONT_BASE_CAMERA_MAX_LINK_DEPTH = 4;

type DominantAxisName = "x" | "y" | "z";

export const cloneStudioUpAxis = () => STUDIO_WORLD_UP_AXIS.clone();

export const projectVectorOntoPlane = (
  vector: THREE.Vector3,
  planeNormal: THREE.Vector3
): THREE.Vector3 => projectVectorOntoPlaneFromContract(vector, planeNormal);

export const getPerpendicularDirection = (upAxis: THREE.Vector3): THREE.Vector3 =>
  getPerpendicularDirectionFromContract(upAxis, ROBOT_FRONT_LOCAL_FORWARD);

const getDominantAxis = (axis: THREE.Vector3): DominantAxisName => {
  const absX = Math.abs(axis.x);
  const absY = Math.abs(axis.y);
  const absZ = Math.abs(axis.z);
  if (absX >= absY && absX >= absZ) return "x";
  if (absY >= absX && absY >= absZ) return "y";
  return "z";
};

export const clampStudioPlanarPose = (
  targetRobot: URDFRobot,
  runtimeUp = cloneStudioUpAxis()
): PlanarClampResult => {
  const dominantAxis = getDominantAxis(runtimeUp);
  if (dominantAxis === "y" && Math.abs(runtimeUp.y) >= DOMINANT_AXIS_THRESHOLD) {
    const clampResult = enforcePlanarBasePose(targetRobot, {
      groundHeightFn: FLAT_GROUND_HEIGHT_FN,
      epsilon: STUDIO_PLANAR_EPSILON,
      lockRollPitch: true,
      updateMatrixWorld: false,
    });
    if (clampResult.clamped) {
      targetRobot.updateMatrixWorld(true);
    }
    return clampResult;
  }

  const reasons: PlanarClampResult["reasons"] = [];
  if (dominantAxis === "z") {
    if (Math.abs(targetRobot.position.z) > STUDIO_PLANAR_EPSILON) {
      targetRobot.position.z = 0;
      reasons.push("y");
    }
    if (Math.abs(targetRobot.rotation.x) > STUDIO_PLANAR_EPSILON) {
      targetRobot.rotation.x = 0;
      reasons.push("roll");
    }
    if (Math.abs(targetRobot.rotation.y) > STUDIO_PLANAR_EPSILON) {
      targetRobot.rotation.y = 0;
      reasons.push("pitch");
    }
  } else {
    if (Math.abs(targetRobot.position.x) > STUDIO_PLANAR_EPSILON) {
      targetRobot.position.x = 0;
      reasons.push("y");
    }
    if (Math.abs(targetRobot.rotation.y) > STUDIO_PLANAR_EPSILON) {
      targetRobot.rotation.y = 0;
      reasons.push("roll");
    }
    if (Math.abs(targetRobot.rotation.z) > STUDIO_PLANAR_EPSILON) {
      targetRobot.rotation.z = 0;
      reasons.push("pitch");
    }
  }
  if (reasons.length > 0) {
    targetRobot.updateMatrixWorld(true);
  }
  return {
    clamped: reasons.length > 0,
    reasons,
    floorHeight: 0,
  };
};

const resolveLinkDepthByName = (
  robot: URDFRobot,
  rootLinkName: string
): Map<string, number> => {
  const depthByLinkName = new Map<string, number>([[rootLinkName, 0]]);
  const rootLink =
    (robot.links?.[rootLinkName] as THREE.Object3D | undefined) ??
    robot.getObjectByName?.(rootLinkName) ??
    null;
  if (!rootLink) return depthByLinkName;

  const queue: Array<{ linkObject: THREE.Object3D; depth: number }> = [
    { linkObject: rootLink, depth: 0 },
  ];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) continue;
    const { linkObject, depth } = entry;
    linkObject.children.forEach((child) => {
      const joint = child as URDFJoint & { isURDFJoint?: boolean };
      if (!joint.isURDFJoint) return;
      joint.children.forEach((jointChild) => {
        const linkChild = jointChild as THREE.Object3D & { isURDFLink?: boolean };
        if (!linkChild.isURDFLink || !linkChild.name) return;
        if (depthByLinkName.has(linkChild.name)) return;
        const nextDepth = depth + 1;
        depthByLinkName.set(linkChild.name, nextDepth);
        queue.push({ linkObject: linkChild, depth: nextDepth });
      });
    });
  }

  return depthByLinkName;
};

export const resolveBaseCameraForwardLocal = ({
  robot,
  cameras,
  rootLinkName,
  worldUp,
}: {
  robot: URDFRobot;
  cameras: RobotCamera[];
  rootLinkName: string | null;
  worldUp: THREE.Vector3;
}): THREE.Vector3 | null => {
  if (!rootLinkName || cameras.length === 0) return null;
  const depthByLinkName = resolveLinkDepthByName(robot, rootLinkName);
  const localUp = localDirectionFromWorld(worldUp, robot.quaternion);
  const centroidWorld = new THREE.Vector3();
  let bestDirection: THREE.Vector3 | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDepth = Number.POSITIVE_INFINITY;

  cameras.forEach((camera) => {
    const parentLinkName = resolveCameraParentLinkNameFromJoint(robot, camera.parent_joint);
    if (!parentLinkName) return;
    const linkDepth = depthByLinkName.get(parentLinkName);
    if (typeof linkDepth !== "number") return;
    if (linkDepth > ROBOT_FRONT_BASE_CAMERA_MAX_LINK_DEPTH) return;
    const { position: cameraWorldPosition } = getCameraWorldPose(robot, camera, {
      updateRobotWorld: false,
    });
    const cameraLocalPosition = robot.worldToLocal(cameraWorldPosition.clone());
    const planarDirection = projectDirectionOntoPlane(
      cameraLocalPosition,
      localUp,
      ROBOT_FRONT_LOCAL_FORWARD.clone()
    );
    let planarLengthSq = planarDirection.lengthSq();
    if (planarLengthSq <= ROBOT_FRONT_CAMERA_DIRECTION_EPSILON) {
      const parentLinkObject =
        (robot.links?.[parentLinkName] as THREE.Object3D | undefined) ??
        robot.getObjectByName?.(parentLinkName) ??
        null;
      if (!parentLinkObject) return;
      const localCentroid = computeOwnedLinkLocalVisualCentroid(parentLinkObject);
      if (!localCentroid) return;
      centroidWorld.copy(localCentroid).applyMatrix4(parentLinkObject.matrixWorld);
      cameraLocalPosition.copy(robot.worldToLocal(centroidWorld.clone()));
      planarDirection.copy(
        projectDirectionOntoPlane(
          cameraLocalPosition,
          localUp,
          ROBOT_FRONT_LOCAL_FORWARD.clone()
        )
      );
      planarLengthSq = planarDirection.lengthSq();
      if (planarLengthSq <= ROBOT_FRONT_CAMERA_DIRECTION_EPSILON) return;
    }
    planarDirection.multiplyScalar(1 / Math.sqrt(planarLengthSq));
    const score = planarDirection.dot(ROBOT_FRONT_LOCAL_FORWARD);
    if (linkDepth > bestDepth) return;
    if (linkDepth === bestDepth && score <= bestScore) return;
    bestDepth = linkDepth;
    bestScore = score;
    bestDirection = planarDirection.clone();
  });

  return bestDirection;
};

export const resolveBaseCameraLikeLinkForwardLocal = ({
  robot,
  rootLinkName,
  worldUp,
}: {
  robot: URDFRobot;
  rootLinkName: string | null;
  worldUp: THREE.Vector3;
}): THREE.Vector3 | null => {
  if (!rootLinkName) return null;
  const depthByLinkName = resolveLinkDepthByName(robot, rootLinkName);
  const localUp = localDirectionFromWorld(worldUp, robot.quaternion);
  const worldPosition = new THREE.Vector3();
  const worldCentroid = new THREE.Vector3();
  let bestDirection: THREE.Vector3 | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDepth = Number.POSITIVE_INFINITY;

  depthByLinkName.forEach((linkDepth, linkName) => {
    if (linkName === rootLinkName) return;
    if (linkDepth > ROBOT_FRONT_BASE_CAMERA_MAX_LINK_DEPTH) return;
    if (!CAMERA_LIKE_LINK_NAME_PATTERN.test(linkName)) return;
    const linkObject =
      (robot.links?.[linkName] as THREE.Object3D | undefined) ??
      robot.getObjectByName?.(linkName) ??
      null;
    if (!linkObject) return;

    linkObject.updateMatrixWorld(true);
    const localCentroid = computeOwnedLinkLocalVisualCentroid(linkObject);
    if (localCentroid) {
      worldCentroid.copy(localCentroid).applyMatrix4(linkObject.matrixWorld);
      worldPosition.copy(worldCentroid);
    } else {
      linkObject.getWorldPosition(worldPosition);
    }
    const linkLocalPosition = robot.worldToLocal(worldPosition.clone());
    const planarDirection = projectDirectionOntoPlane(
      linkLocalPosition,
      localUp,
      ROBOT_FRONT_LOCAL_FORWARD.clone()
    );
    const planarLengthSq = planarDirection.lengthSq();
    if (planarLengthSq <= ROBOT_FRONT_CAMERA_DIRECTION_EPSILON) return;
    planarDirection.multiplyScalar(1 / Math.sqrt(planarLengthSq));
    const score = planarDirection.dot(ROBOT_FRONT_LOCAL_FORWARD);
    if (linkDepth > bestDepth) return;
    if (linkDepth === bestDepth && score <= bestScore) return;
    bestDepth = linkDepth;
    bestScore = score;
    bestDirection = planarDirection.clone();
  });

  return bestDirection;
};
