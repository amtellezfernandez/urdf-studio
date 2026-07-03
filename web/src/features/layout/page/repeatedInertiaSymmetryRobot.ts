import * as THREE from "three";

import { parseUrdfDocument } from "@/shared/lib/urdfCore";
import { composeUrdfPoseMatrix } from "@/shared/lib/spatialFrame";
import { readUrdfJointTopology } from "@/shared/lib/urdfTopology";

export type ParsedJoint = {
  childLinkName: string;
  jointName: string;
  jointType: string;
  originRpy: [number, number, number];
  originXyz: [number, number, number];
  parentLinkName: string;
  transform: THREE.Matrix4;
};

export type ParsedRobot = {
  childJointsByParentLink: Map<string, ParsedJoint[]>;
  jointByChildLink: Map<string, ParsedJoint>;
  linkReferenceCentersLocal: Map<string, THREE.Vector3>;
  linkReferenceCentersWorld: Map<string, THREE.Vector3>;
  linkWorldMatrices: Map<string, THREE.Matrix4>;
  linkWorldPositions: Map<string, THREE.Vector3>;
  parentByChildLink: Map<string, string>;
};

export type RepeatedInertiaSymmetryLinkCentersLocal = ReadonlyMap<string, THREE.Vector3>;

export const parseOriginTriplet = (
  value: string | null | undefined
): [number, number, number] => {
  const parts = (value ?? "0 0 0")
    .split(/\s+/)
    .map((component) => Number(component))
    .filter((component) => Number.isFinite(component));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
};

const resolveLinkReferenceCenterLocal = (
  linkElement: Element
): THREE.Vector3 | null => {
  const collisionOriginElements = Array.from(
    linkElement.querySelectorAll(":scope > collision > origin")
  );
  const visualOriginElements =
    collisionOriginElements.length === 0
      ? Array.from(linkElement.querySelectorAll(":scope > visual > origin"))
      : [];
  const originElements =
    collisionOriginElements.length > 0 ? collisionOriginElements : visualOriginElements;
  if (originElements.length === 0) {
    return null;
  }

  const summedCenter = originElements.reduce(
    (sum, originElement) =>
      sum.add(
        new THREE.Vector3().fromArray(parseOriginTriplet(originElement.getAttribute("xyz")))
      ),
    new THREE.Vector3()
  );
  return summedCenter.multiplyScalar(1 / originElements.length);
};

export const parseRepeatedInertiaSymmetryRobot = (
  urdfContent: string,
  options: {
    linkCentersLocal?: RepeatedInertiaSymmetryLinkCentersLocal | null;
  } = {}
): ParsedRobot | null => {
  const xmlDocument = parseUrdfDocument(urdfContent);
  const robotElement = xmlDocument?.querySelector("robot");
  if (!robotElement) {
    return null;
  }

  const joints = readUrdfJointTopology(robotElement)
    .map(({ jointElement, ...jointTopology }) => {
      const originElement = jointElement.querySelector(":scope > origin");
      const originXyz = parseOriginTriplet(originElement?.getAttribute("xyz"));
      const originRpy = parseOriginTriplet(originElement?.getAttribute("rpy"));
      return {
        ...jointTopology,
        originRpy,
        originXyz,
        transform: composeUrdfPoseMatrix(
          {
            xyz: originXyz,
            rpy: originRpy,
          },
          new THREE.Matrix4()
        ),
      };
    });

  const linkElements = Array.from(robotElement.querySelectorAll(":scope > link[name]"));
  const linkNames = linkElements
    .map((linkElement) => linkElement.getAttribute("name") ?? "")
    .filter(Boolean);
  const linkReferenceCentersLocal = new Map(
    linkElements
      .map((linkElement) => {
        const linkName = linkElement.getAttribute("name") ?? "";
        const referenceCenter =
          options.linkCentersLocal?.get(linkName)?.clone() ??
          resolveLinkReferenceCenterLocal(linkElement);
        return linkName && referenceCenter ? ([linkName, referenceCenter] as const) : null;
      })
      .filter((entry): entry is readonly [string, THREE.Vector3] => entry !== null)
  );
  const childLinkNames = new Set(joints.map((joint) => joint.childLinkName));
  const rootLinkNames = linkNames.filter((linkName) => !childLinkNames.has(linkName));
  if (rootLinkNames.length === 0) {
    return null;
  }

  const linkWorldMatrices = new Map<string, THREE.Matrix4>(
    rootLinkNames.map((linkName) => [linkName, new THREE.Matrix4().identity()])
  );
  const remainingJoints = [...joints];
  while (remainingJoints.length > 0) {
    let resolvedJointCount = 0;
    for (let index = remainingJoints.length - 1; index >= 0; index -= 1) {
      const joint = remainingJoints[index];
      const parentMatrix = linkWorldMatrices.get(joint.parentLinkName);
      if (!parentMatrix) {
        continue;
      }
      const childMatrix = new THREE.Matrix4().multiplyMatrices(parentMatrix, joint.transform);
      linkWorldMatrices.set(joint.childLinkName, childMatrix);
      remainingJoints.splice(index, 1);
      resolvedJointCount += 1;
    }
    if (resolvedJointCount === 0) {
      break;
    }
  }

  const linkWorldPositions = new Map<string, THREE.Vector3>();
  const linkReferenceCentersWorld = new Map<string, THREE.Vector3>();
  linkWorldMatrices.forEach((matrix, linkName) => {
    const linkWorldPosition = new THREE.Vector3().setFromMatrixPosition(matrix);
    linkWorldPositions.set(linkName, linkWorldPosition);
    const referenceCenterLocal = linkReferenceCentersLocal.get(linkName);
    if (referenceCenterLocal) {
      linkReferenceCentersWorld.set(linkName, referenceCenterLocal.clone().applyMatrix4(matrix));
    } else {
      linkReferenceCentersWorld.set(linkName, linkWorldPosition.clone());
    }
  });

  return {
    childJointsByParentLink: new Map(
      linkNames.map((linkName) => [
        linkName,
        joints
          .filter((joint) => joint.parentLinkName === linkName)
          .sort(
            (left, right) =>
              left.jointType.localeCompare(right.jointType) ||
              left.childLinkName.localeCompare(right.childLinkName) ||
              left.jointName.localeCompare(right.jointName)
          ),
      ])
    ),
    jointByChildLink: new Map(joints.map((joint) => [joint.childLinkName, joint] as const)),
    linkReferenceCentersLocal,
    linkReferenceCentersWorld,
    linkWorldMatrices,
    linkWorldPositions,
    parentByChildLink: new Map(
      joints.map((joint) => [joint.childLinkName, joint.parentLinkName] as const)
    ),
  };
};
