import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

export type RobotPointerSelection = {
  hitRobot: boolean;
  linkName: string | undefined;
  jointName: string | null;
};

export const resolveObjectAssemblyModelId = (
  object: THREE.Object3D
): string | null => {
  let node: THREE.Object3D | null = object;
  while (node) {
    const candidateId = node.userData?.assemblyModelId;
    if (typeof candidateId === "string" && candidateId.length > 0) {
      return candidateId;
    }
    node = node.parent;
  }
  return null;
};

export const isObjectDescendantOf = (
  object: THREE.Object3D,
  ancestor: THREE.Object3D
): boolean => {
  let cursor: THREE.Object3D | null = object;
  while (cursor) {
    if (cursor === ancestor) return true;
    cursor = cursor.parent;
  }
  return false;
};

const resolveJointNameForLink = (
  robot: URDFRobot,
  linkName: string
): string | null => {
  for (const [jointName, joint] of Object.entries(robot.joints ?? {})) {
    if ((joint.children ?? []).some((child) => child.name === linkName)) {
      return jointName;
    }
  }
  return null;
};

const resolveAncestorLinkName = (
  object: THREE.Object3D,
  linkNames: ReadonlySet<string>
): string | undefined => {
  let cursor: THREE.Object3D | null = object;
  while (cursor) {
    if (linkNames.has(cursor.name)) {
      return cursor.name;
    }
    cursor = cursor.parent;
  }
  return undefined;
};

export const resolveRobotPointerSelection = ({
  hitObject,
  robot,
}: {
  hitObject: THREE.Object3D;
  robot: URDFRobot;
}): RobotPointerSelection => {
  const hitRobot = isObjectDescendantOf(hitObject, robot);
  const linkNameSet = new Set(Object.keys(robot.links || {}));
  let linkName = resolveAncestorLinkName(hitObject, linkNameSet);
  let jointName = linkName ? resolveJointNameForLink(robot, linkName) : null;

  if (!jointName) {
    for (const [candidateJointName, candidateJoint] of Object.entries(robot.joints ?? {})) {
      const child = (candidateJoint.children ?? [])[0] as THREE.Object3D | undefined;
      if (!child) continue;
      if (isObjectDescendantOf(hitObject, child)) {
        jointName = candidateJointName;
        linkName = linkName ?? (child.name || undefined);
        break;
      }
    }
  }

  return {
    hitRobot,
    linkName,
    jointName,
  };
};
