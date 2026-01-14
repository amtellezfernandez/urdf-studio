/**
 * Auto-compute camera pose based on parent link geometry
 *
 * Follows robotics conventions:
 * - Robot frame: X=forward, Y=left, Z=up
 * - Camera frame: X=forward viewing direction, Y=right, Z=up
 *
 * The camera is positioned at the center of the parent link,
 * looking forward along the kinematic chain.
 */

import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

interface CameraPoseConfig {
  xyz: [number, number, number];
  rpy: [number, number, number]; // In radians
}

interface AutoComputeOptions {
  marginForward?: number; // Distance in front of the link (meters)
  marginUp?: number; // Height above link center (meters)
  marginRight?: number; // Offset to the right (meters)
}

/**
 * Compute bounding box for a specific link in the robot
 */
export function computeLinkBoundingBox(robot: URDFRobot | null, linkName: string): THREE.Box3 | null {
  if (!robot) return null;

  // Get the link object from the robot
  const linkObject = robot.links?.[linkName] ?? robot.getObjectByName?.(linkName);
  if (!linkObject) {
    console.warn(`Link "${linkName}" not found in robot`);
    return null;
  }

  // Get all link names to detect child links
  const allLinkNames = new Set(Object.keys(robot.links || {}));

  // Create a bounding box that only includes this link's geometry
  // (not child links)
  const box = new THREE.Box3();
  let hasGeometry = false;

  const traverse = (obj: THREE.Object3D) => {
    // Skip child links
    if (obj !== linkObject && allLinkNames.has(obj.name)) {
      return;
    }

    // Include meshes in the bounding box
    if (obj instanceof THREE.Mesh) {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) {
          const meshBox = mesh.geometry.boundingBox.clone();
          meshBox.applyMatrix4(mesh.matrixWorld);
          box.union(meshBox);
          hasGeometry = true;
        }
      }
    }

    // Traverse children
    for (const child of obj.children) {
      // Stop if we encounter another link
      if (allLinkNames.has(child.name)) {
        continue;
      }
      traverse(child);
    }
  };

  traverse(linkObject);

  if (!hasGeometry) {
    console.warn(`Link "${linkName}" has no geometry for bounding box computation`);
    return null;
  }

  return box;
}

/**
 * Auto-compute camera pose relative to parent link
 *
 * Algorithm:
 * 1. Compute parent link's bounding box in its local frame
 * 2. Position camera at the center of the link
 * 3. Orient camera to look forward along +X axis (90° rotation around Z)
 *
 * Camera convention: Three.js cameras look down -Z axis
 * Robot convention: +X is forward, +Y is left, +Z is up
 * Solution: Rotate camera 90° around Z to align camera's -Z with robot's +X
 *
 * @param robot - The URDF robot object
 * @param parentLink - Name of the parent link
 * @param options - Margin offsets (unused, kept for compatibility)
 * @returns Camera pose in parent link's coordinate frame
 */
function autoComputeCameraPose(
  robot: URDFRobot | null,
  parentLink: string,
  options: AutoComputeOptions = {},
): CameraPoseConfig | null {
  const bbox = computeLinkBoundingBox(robot, parentLink);
  if (!bbox) {
    return null;
  }

  // Get the link object to work in local coordinates
  const linkObject = robot.links?.[parentLink] ?? robot.getObjectByName?.(parentLink);
  if (!linkObject) {
    return null;
  }

  // Transform bounding box to local coordinates
  linkObject.updateMatrixWorld(true);
  const linkWorldMatrixInverse = linkObject.matrixWorld.clone().invert();

  const localBBox = bbox.clone().applyMatrix4(linkWorldMatrixInverse);

  // Get center of the link in local coordinates
  const localCenter = new THREE.Vector3();
  localBBox.getCenter(localCenter);

  // Position camera at the center of the link
  const localPosition = localCenter.clone();

  // Camera orientation: rotate 90° around Z axis to look along +X
  // In URDF RPY convention (ZYX intrinsic order):
  // - Roll (around X): 0
  // - Pitch (around Y): 0
  // - Yaw (around Z): 90° (π/2 radians)
  // This makes the camera's -Z axis point along the link's +X axis (forward)
  const localRotation: [number, number, number] = [0, 0, Math.PI / 2];

  return {
    xyz: [localPosition.x, localPosition.y, localPosition.z],
    rpy: localRotation,
  };
}

/**
 * Auto-compute camera pose with default settings
 * Positions camera at the center of the link
 */
export function autoComputeCameraPoseDefault(robot: URDFRobot | null, parentLink: string): CameraPoseConfig | null {
  return autoComputeCameraPose(robot, parentLink);
}

/**
 * Convert pose to YAML-compatible array format [x, y, z, roll, pitch, yaw]
 */
