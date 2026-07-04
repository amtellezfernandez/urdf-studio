import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

export type LinkWorldPose = {
  position: { x: number; y: number; z: number };
  quaternion: { w: number; x: number; y: number; z: number };
};

export const resolveHierarchyTreeViewEmptyState = ({
  hasHierarchyTree,
  rootLinkCount,
}: {
  hasHierarchyTree: boolean;
  rootLinkCount: number;
}): string =>
  !hasHierarchyTree || rootLinkCount === 0 ? "No joints found" : "";

export const resolveHierarchyTreeViewErrorState = (): string =>
  "Error rendering hierarchy view. Check console for details.";

export const resolveNextEndEffectorLink = ({
  currentEndEffectorLink,
  linkName,
}: {
  currentEndEffectorLink: string | null | undefined;
  linkName: string;
}): string | null => (currentEndEffectorLink === linkName ? null : linkName);

export const extractLinkWorldPose = (
  robot: URDFRobot | null | undefined,
  linkName: string
): LinkWorldPose | null => {
  if (!robot) {
    return null;
  }

  const linkObject = robot.links?.[linkName] ?? robot.getObjectByName?.(linkName);
  if (!linkObject) {
    return null;
  }

  linkObject.updateMatrixWorld?.(true);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  linkObject.matrixWorld.decompose(position, quaternion, scale);

  return {
    position: { x: position.x, y: position.y, z: position.z },
    quaternion: { w: quaternion.w, x: quaternion.x, y: quaternion.y, z: quaternion.z },
  };
};
