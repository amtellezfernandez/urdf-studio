import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

type URDFRobotWithMeta = URDFRobot & {
  links?: Record<string, THREE.Object3D | undefined>;
  userData?: { boundingBoxCenter?: THREE.Vector3 };
};

export type RobotFocusBounds = {
  center: THREE.Vector3;
  size: THREE.Vector3;
  radius: number;
};

export const computeRobotFocusBounds = (
  robot: URDFRobot | null
): RobotFocusBounds | null => {
  if (!robot) return null;

  const robotAny = robot as URDFRobotWithMeta;
  const geometryBox = new THREE.Box3();

  try {
    robot.updateMatrixWorld(true);
    geometryBox.setFromObject(robot);
  } catch {
    // Continue with link-position fallback.
  }

  const linkBox = new THREE.Box3();
  const linkPosition = new THREE.Vector3();
  const links = Object.values(robotAny.links ?? {});
  let hasLinkPoints = false;

  for (const link of links) {
    if (!link) continue;
    link.getWorldPosition(linkPosition);
    if (!Number.isFinite(linkPosition.x) || !Number.isFinite(linkPosition.y) || !Number.isFinite(linkPosition.z)) {
      continue;
    }
    if (!hasLinkPoints) {
      linkBox.min.copy(linkPosition);
      linkBox.max.copy(linkPosition);
      hasLinkPoints = true;
    } else {
      linkBox.expandByPoint(linkPosition);
    }
  }

  const combined = geometryBox.clone();
  if (hasLinkPoints) {
    if (combined.isEmpty()) {
      combined.copy(linkBox);
    } else {
      combined.union(linkBox);
    }
  }

  if (combined.isEmpty()) {
    const center = robotAny.userData?.boundingBoxCenter?.clone() ?? new THREE.Vector3(0, 0, 0);
    const size = new THREE.Vector3(0.5, 0.5, 0.5);
    return {
      center,
      size,
      radius: 0.25,
    };
  }

  const center = combined.getCenter(new THREE.Vector3());
  const size = combined.getSize(new THREE.Vector3());
  const sphere = combined.getBoundingSphere(new THREE.Sphere());
  const halfDiagonal = size.length() * 0.5;

  return {
    center,
    size,
    radius: Math.max(sphere.radius, halfDiagonal, 0.25),
  };
};
