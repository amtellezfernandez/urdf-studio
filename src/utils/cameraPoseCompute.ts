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
 * 1. Compute parent link's bounding box
 * 2. Position camera in front of and above the link
 * 3. Orient camera to look forward (identity rotation in parent frame)
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

  // Get bounding box dimensions in world space
  const size = new THREE.Vector3();
  bbox.getSize(size);

  const center = new THREE.Vector3();
  bbox.getCenter(center);

  // Get the link object to transform from world to local coordinates
  const linkObject = robot.links?.[parentLink] ?? robot.getObjectByName?.(parentLink);
  if (!linkObject) {
    return null;
  }

  // Compute position: forward from the front face, up from center, centered laterally
  // In world coordinates
  const worldPosition = new THREE.Vector3(
    bbox.max.x + marginForward,  // Front of the bounding box + margin
    center.y + marginRight,      // Center Y (left-right)
    center.z + marginUp          // Center Z + margin (up)
  );

  // Transform world position to parent link's local coordinates
  const linkWorldMatrix = new THREE.Matrix4();
  linkObject.updateMatrixWorld(true);
  linkWorldMatrix.copy(linkObject.matrixWorld);

  const linkWorldMatrixInverse = linkWorldMatrix.clone().invert();
  const localPosition = worldPosition.applyMatrix4(linkWorldMatrixInverse);

  // Camera orientation: identity in parent frame
  // This means the camera's +X axis points along the parent's +X axis (forward)
  // Camera's +Y axis points along parent's +Y axis (right for camera, left for robot)
  // Camera's +Z axis points along parent's +Z axis (up)
  const localRotation: [number, number, number] = [0, 0, 0];

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
