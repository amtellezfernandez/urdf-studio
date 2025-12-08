/**
 * Auto-compute camera pose based on parent link geometry
 *
 * Follows robotics conventions:
 * - Robot frame: X=forward, Y=left, Z=up
 * - Camera frame: X=forward viewing direction, Y=right, Z=up
 *
 * The camera is positioned in front of and above the parent link,
 * looking forward along the kinematic chain (never backward toward base).
 */

import * as THREE from 'three';

export interface CameraPoseConfig {
  xyz: [number, number, number];
  rpy: [number, number, number]; // In radians
}

export interface AutoComputeOptions {
  marginForward?: number;  // Distance in front of the link (meters)
  marginUp?: number;       // Height above link center (meters)
  marginRight?: number;    // Offset to the right (meters)
}

/**
 * Compute bounding box for a specific link in the robot
 */
export function computeLinkBoundingBox(
  robot: any,
  linkName: string
): THREE.Box3 | null {
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
 * 2. Position camera in front of and above the link (in local coordinates)
 * 3. Orient camera to look forward along +X axis (90° rotation around Z)
 *
 * Camera convention: Three.js cameras look down -Z axis
 * Robot convention: +X is forward, +Y is left, +Z is up
 * Solution: Rotate camera 90° around Z to align camera's -Z with robot's +X
 *
 * @param robot - The URDF robot object
 * @param parentLink - Name of the parent link
 * @param options - Margin offsets (default: 3cm forward, 5cm up)
 * @returns Camera pose in parent link's coordinate frame
 */
export function autoComputeCameraPose(
  robot: any,
  parentLink: string,
  options: AutoComputeOptions = {}
): CameraPoseConfig | null {
  const {
    marginForward = 0.03,  // 3cm forward
    marginUp = 0.05,       // 5cm up
    marginRight = 0.0,     // Centered left-right
  } = options;

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

  const localSize = new THREE.Vector3();
  localBBox.getSize(localSize);

  const localCenter = new THREE.Vector3();
  localBBox.getCenter(localCenter);

  // Compute position in local coordinates:
  // - Place camera at the front of the link (+X direction)
  // - Center it left-right (Y axis)
  // - Slightly above center (Z axis)
  const localPosition = new THREE.Vector3(
    localBBox.max.x + marginForward,  // Front of the link + margin
    localCenter.y + marginRight,      // Center Y (left-right)
    localCenter.z + marginUp          // Center Z + margin (up)
  );

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
 * Auto-compute camera pose with default heuristics
 * Uses conservative margins that work for most robot links
 */
export function autoComputeCameraPoseDefault(
  robot: any,
  parentLink: string
): CameraPoseConfig | null {
  return autoComputeCameraPose(robot, parentLink, {
    marginForward: 0.03,  // 3cm in front
    marginUp: 0.05,       // 5cm above center
    marginRight: 0.0,     // Centered
  });
}

/**
 * Convert pose to YAML-compatible array format [x, y, z, roll, pitch, yaw]
 */
export function poseToArray(pose: CameraPoseConfig): number[] {
  return [...pose.xyz, ...pose.rpy];
}

/**
 * Format pose for display (with units and degree conversion)
 */
export function formatPoseForDisplay(pose: CameraPoseConfig): string {
  const radToDeg = (rad: number) => (rad * 180 / Math.PI).toFixed(1);
  return `Position: [${pose.xyz.map(v => v.toFixed(3)).join(', ')}] m\n` +
         `Rotation: [${pose.rpy.map(radToDeg).join(', ')}] deg`;
}
