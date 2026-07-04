import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { resolveRobotObjectByName } from "@/features/viewer/viewer-helpers";

export type TrackingReference = {
  name: string;
  kind: "joint" | "link" | "end-effector";
  label: string;
  position: THREE.Vector3 | null;
};

const getJointWorldPosition = (robot: URDFRobot | null | undefined, jointName: string) => {
  if (!robot || !jointName) return null;
  try {
    const joint = robot.joints?.[jointName];
    if (!joint) return null;
    joint.updateWorldMatrix?.(true, true);
    const pos = new THREE.Vector3();
    joint.getWorldPosition(pos);
    return pos;
  } catch {
    return null;
  }
};

const getLinkWorldPosition = (robot: URDFRobot | null | undefined, linkName: string) => {
  if (!robot || !linkName) return null;
  try {
    const link = resolveRobotObjectByName(robot, linkName);
    if (!link) return null;
    link.updateMatrixWorld?.(true);
    const pos = new THREE.Vector3();
    link.getWorldPosition(pos);
    return pos;
  } catch {
    return null;
  }
};

export const resolveTrackingReference = ({
  robot,
  trackedName,
  endEffectorLink,
}: {
  robot?: URDFRobot | null;
  trackedName?: string | null;
  endEffectorLink?: string | null;
}): TrackingReference | null => {
  if (trackedName) {
    const jointPos = getJointWorldPosition(robot, trackedName);
    if (jointPos) {
      return {
        name: trackedName,
        kind: "joint",
        label: `Joint: ${trackedName}`,
        position: jointPos,
      };
    }
    return {
      name: trackedName,
      kind: "link",
      label: `Link: ${trackedName}`,
      position: getLinkWorldPosition(robot, trackedName),
    };
  }

  if (!endEffectorLink) return null;

  const endEffectorPos =
    getJointWorldPosition(robot, endEffectorLink) ?? getLinkWorldPosition(robot, endEffectorLink);
  return {
    name: endEffectorLink,
    kind: "end-effector",
    label: `End-effector: ${endEffectorLink}`,
    position: endEffectorPos,
  };
};
