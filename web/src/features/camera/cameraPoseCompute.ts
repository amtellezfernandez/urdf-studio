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
  aimLink?: string | null; // Link to aim the camera toward (world direction)
  robotBoundingBox?: THREE.Box3 | null;
  targetPosition?: THREE.Vector3 | [number, number, number] | null;
  marginForward?: number; // Distance in front of the link (meters)
  marginUp?: number; // Height above link center (meters)
  rollOffset?: number; // Extra rotation around camera X (radians)
  pitchOffset?: number; // Extra rotation around camera Y (radians)
  yawOffset?: number; // Extra rotation around camera Z (radians)
  useWorldUp?: boolean; // Force camera to stay upright in world space
}

const DEFAULT_MARGIN_FORWARD = 0.03;
const DEFAULT_MARGIN_UP = 0.02;
const MIN_BACK_OFFSET = 0.05;

const resolveLinkObject = (robot: URDFRobot | null, linkName: string) =>
  robot?.links?.[linkName] ?? robot?.getObjectByName?.(linkName) ?? null;

/**
 * Compute bounding box for a specific link in the robot
 */
export function computeLinkBoundingBox(robot: URDFRobot | null, linkName: string): THREE.Box3 | null {
  if (!robot) return null;

  // Get the link object from the robot
  const linkObject = resolveLinkObject(robot, linkName);
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
 * 1. Find an aim direction using a helper link or the robot bounding box.
 * 2. Offset the camera forward along the aim direction to avoid occlusion.
 * 3. Align the camera's +X axis with the aim direction (URDF camera convention).
 *
 * Camera convention: X=forward, Y=left, Z=up.
 *
 * @param robot - The URDF robot object
 * @param parentLink - Name of the parent link
 * @param options - Aim link and offsets
 * @returns Camera pose in parent link's coordinate frame
 */
function autoComputeCameraPose(
  robot: URDFRobot | null,
  parentLink: string,
  options: AutoComputeOptions = {},
): CameraPoseConfig | null {
  const linkObject = resolveLinkObject(robot, parentLink);
  if (!linkObject) {
    return null;
  }
  linkObject.updateMatrixWorld(true);
  const parentWorld = linkObject.matrixWorld.clone();
  const parentWorldInverse = parentWorld.clone().invert();
  const parentPosition = new THREE.Vector3();
  const parentQuat = new THREE.Quaternion();
  parentWorld.decompose(parentPosition, parentQuat, new THREE.Vector3());

  const worldUp = new THREE.Vector3(0, 0, 1);
  const linkForward = new THREE.Vector3(1, 0, 0).applyQuaternion(parentQuat).normalize();
  const linkUp = new THREE.Vector3(0, 0, 1).applyQuaternion(parentQuat).normalize();
  const aimDirection = new THREE.Vector3();
  let hasAim = false;
  let outwardDirection: THREE.Vector3 | null = null;

  if (options.targetPosition) {
    const target =
      options.targetPosition instanceof THREE.Vector3
        ? options.targetPosition
        : new THREE.Vector3(...options.targetPosition);
    aimDirection.copy(target).sub(parentPosition);
    if (aimDirection.length() > 1e-4) {
      aimDirection.normalize();
      hasAim = true;
    }
  }

  if (options.aimLink) {
    const aimObject = resolveLinkObject(robot, options.aimLink);
    if (aimObject) {
      aimObject.updateMatrixWorld(true);
      const aimPosition = new THREE.Vector3().setFromMatrixPosition(aimObject.matrixWorld);
      if (!hasAim) {
        aimDirection.copy(aimPosition).sub(parentPosition);
        if (aimDirection.length() > 1e-4) {
          aimDirection.normalize();
          hasAim = true;
        }
      }
    }
  }

  if (options.robotBoundingBox) {
    const center = options.robotBoundingBox.getCenter(new THREE.Vector3());
    const candidate = parentPosition.clone().sub(center);
    if (candidate.length() > 1e-4) {
      outwardDirection = candidate.normalize();
    }
  }

  if (!hasAim) {
    aimDirection.copy(linkForward).normalize();
  }

  if (outwardDirection && aimDirection.dot(outwardDirection) < 0) {
    aimDirection.multiplyScalar(-1);
  }

  const bbox =
    computeLinkBoundingBox(robot, parentLink) ??
    (options.aimLink ? computeLinkBoundingBox(robot, options.aimLink) : null);
  let backOffset = options.marginForward ?? DEFAULT_MARGIN_FORWARD;
  if (bbox) {
    const size = bbox.getSize(new THREE.Vector3());
    backOffset = Math.max(MIN_BACK_OFFSET, size.length() * 0.6 + backOffset);
  } else {
    backOffset = Math.max(MIN_BACK_OFFSET, backOffset + 0.06);
  }
  const upOffset = options.marginUp ?? DEFAULT_MARGIN_UP;

  const upAxis = options.useWorldUp
    ? worldUp
    : Math.abs(linkUp.dot(aimDirection)) > 0.9
    ? worldUp
    : linkUp;
  const worldPosition = parentPosition
    .clone()
    .sub(aimDirection.clone().multiplyScalar(backOffset))
    .add(upAxis.clone().multiplyScalar(upOffset));

  let lookDirection = aimDirection.clone();
  if (options.targetPosition) {
    const target =
      options.targetPosition instanceof THREE.Vector3
        ? options.targetPosition
        : new THREE.Vector3(...options.targetPosition);
    const candidate = target.clone().sub(worldPosition);
    if (candidate.length() > 1e-4) {
      lookDirection = candidate.normalize();
    }
  }

  const xAxis = lookDirection.clone().normalize();
  const upRef = Math.abs(xAxis.dot(upAxis)) > 0.9 ? worldUp : upAxis;
  const yAxis = new THREE.Vector3().crossVectors(upRef, xAxis).normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

  const worldRotation = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const worldQuat = new THREE.Quaternion().setFromRotationMatrix(worldRotation);
  const worldMatrix = new THREE.Matrix4().compose(
    worldPosition,
    worldQuat,
    new THREE.Vector3(1, 1, 1)
  );

  const localMatrix = parentWorldInverse.multiply(worldMatrix);
  const localPosition = new THREE.Vector3();
  const localQuat = new THREE.Quaternion();
  const localScale = new THREE.Vector3();
  localMatrix.decompose(localPosition, localQuat, localScale);
  const localEuler = new THREE.Euler().setFromQuaternion(localQuat, "ZYX");
  localEuler.x += options.rollOffset ?? 0;
  localEuler.y += options.pitchOffset ?? 0;
  localEuler.z += options.yawOffset ?? 0;

  return {
    xyz: [localPosition.x, localPosition.y, localPosition.z],
    rpy: [localEuler.x, localEuler.y, localEuler.z],
  };
}

/**
 * Auto-compute camera pose with default settings
 * Positions camera behind the link to keep the gripper in view
 */
export function autoComputeCameraPoseDefault(
  robot: URDFRobot | null,
  parentLink: string,
  options?: AutoComputeOptions
): CameraPoseConfig | null {
  return autoComputeCameraPose(robot, parentLink, options);
}

/**
 * Convert pose to YAML-compatible array format [x, y, z, roll, pitch, yaw]
 */
