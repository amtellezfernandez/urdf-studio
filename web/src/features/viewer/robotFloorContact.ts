import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { CreatedObject } from "@/features/objects";
import {
  normalizeWorldObjectRotationEuler,
  resolveWorldObjectGeometry,
} from "@/features/objects/worldObjectGeometry";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import type { SolidWorldBounds } from "@/features/viewer/worldCollisionBoundsStore";

export const STUDIO_FLOOR_Z_M = 0;
export const STUDIO_ROBOT_FLOOR_CLEARANCE_M = 0.0005;
export const STUDIO_ROBOT_FLOOR_WORSENING_TOLERANCE_M = 0.001;
export const STUDIO_ROBOT_OBJECT_PENETRATION_TOLERANCE_M = 0.004;

export type RobotFloorContactResult = {
  safe: boolean;
  minWorldZ: number | null;
  penetrationM: number;
  baselinePenetrationM: number;
  objectCollision:
    | {
        obstacleId: string;
        penetrationM: number;
      }
    | null;
};

const getRobotMeshWorldBounds = (
  robot: THREE.Object3D | null | undefined
): THREE.Box3[] => {
  if (!robot) return [];
  robot.updateMatrixWorld(true);
  const bounds: THREE.Box3[] = [];
  const box = new THREE.Box3();

  robot.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingBox) return;
    box.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    if (!box.isEmpty()) {
      bounds.push(box.clone());
    }
  });

  return bounds;
};

export const computeRobotMeshMinWorldZ = (
  robot: THREE.Object3D | null | undefined
): number | null => {
  let minWorldZ = Number.POSITIVE_INFINITY;
  getRobotMeshWorldBounds(robot).forEach((bounds) => {
    if (Number.isFinite(bounds.min.z)) {
      minWorldZ = Math.min(minWorldZ, bounds.min.z);
    }
  });
  return Number.isFinite(minWorldZ) ? minWorldZ : null;
};

const boxOverlapDepth = (a: THREE.Box3, b: THREE.Box3): number => {
  if (!a.intersectsBox(b)) return 0;
  const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const overlapZ = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  return Math.max(0, Math.min(overlapX, overlapY, overlapZ));
};

const resolveDeepestRobotObstacleCollision = (
  robotMeshBounds: readonly THREE.Box3[],
  obstacleBounds: readonly SolidWorldBounds[],
  toleranceM: number
): RobotFloorContactResult["objectCollision"] => {
  let deepest: RobotFloorContactResult["objectCollision"] = null;
  for (const robotBounds of robotMeshBounds) {
    for (const obstacle of obstacleBounds) {
      const penetrationM = boxOverlapDepth(robotBounds, obstacle.bounds);
      if (penetrationM <= toleranceM) continue;
      if (!deepest || penetrationM > deepest.penetrationM) {
        deepest = {
          obstacleId: obstacle.id,
          penetrationM,
        };
      }
    }
  }
  return deepest;
};

const resolveRobotMeshFloorPenetration = (
  robot: THREE.Object3D,
  floorZ: number,
  clearanceM: number
): {
  bounds: THREE.Box3[];
  minWorldZ: number | null;
  penetrationM: number;
} => {
  robot.updateMatrixWorld(true);
  const bounds = getRobotMeshWorldBounds(robot);
  const minWorldZ = bounds.reduce(
    (currentMin, box) => Math.min(currentMin, box.min.z),
    Number.POSITIVE_INFINITY
  );
  const resolvedMinWorldZ = Number.isFinite(minWorldZ) ? minWorldZ : null;
  const requiredMinZ = floorZ + clearanceM;
  const penetrationM =
    resolvedMinWorldZ === null ? 0 : Math.max(0, requiredMinZ - resolvedMinWorldZ);
  return {
    bounds,
    minWorldZ: resolvedMinWorldZ,
    penetrationM,
  };
};

export const buildWorldObjectObstacleBounds = (
  objects: readonly CreatedObject[]
): SolidWorldBounds[] =>
  objects
    .filter((object) => object.isHidden !== true)
    .map((object) => {
      const geometry = resolveWorldObjectGeometry(object);
      const halfSize = geometry.size.clone().multiplyScalar(0.5);
      const localBounds = new THREE.Box3(
        halfSize.clone().multiplyScalar(-1),
        halfSize.clone()
      );
      const matrix = new THREE.Matrix4().compose(
        geometry.position,
        new THREE.Quaternion().setFromEuler(
          normalizeWorldObjectRotationEuler(object.rotation)
        ),
        new THREE.Vector3(1, 1, 1)
      );
      return {
        id: object.id,
        bounds: localBounds.applyMatrix4(matrix),
      };
    })
    .filter((entry) => entry.bounds.isEmpty() === false);

export const evaluateRobotJointPoseFloorContact = ({
  robot,
  candidateJointValues,
  restoreJointValues,
  obstacleBounds = [],
  floorZ = STUDIO_FLOOR_Z_M,
  clearanceM = STUDIO_ROBOT_FLOOR_CLEARANCE_M,
  objectPenetrationToleranceM = STUDIO_ROBOT_OBJECT_PENETRATION_TOLERANCE_M,
}: {
  robot: URDFRobot | null;
  candidateJointValues: Record<string, number>;
  restoreJointValues: Record<string, number>;
  obstacleBounds?: readonly SolidWorldBounds[];
  floorZ?: number;
  clearanceM?: number;
  objectPenetrationToleranceM?: number;
}): RobotFloorContactResult => {
  if (!robot) {
    return {
      safe: true,
      minWorldZ: null,
      penetrationM: 0,
      baselinePenetrationM: 0,
      objectCollision: null,
    };
  }

  try {
    applyJointValues(robot, restoreJointValues, { filter: false });
    const baseline = resolveRobotMeshFloorPenetration(robot, floorZ, clearanceM);
    applyJointValues(robot, candidateJointValues, { filter: false });
    const candidate = resolveRobotMeshFloorPenetration(robot, floorZ, clearanceM);
    const objectCollision = resolveDeepestRobotObstacleCollision(
      candidate.bounds,
      obstacleBounds,
      objectPenetrationToleranceM
    );
    const floorPenetrationWorsened =
      candidate.penetrationM >
      baseline.penetrationM + STUDIO_ROBOT_FLOOR_WORSENING_TOLERANCE_M;
    return {
      safe: !floorPenetrationWorsened && objectCollision === null,
      minWorldZ: candidate.minWorldZ,
      penetrationM: candidate.penetrationM,
      baselinePenetrationM: baseline.penetrationM,
      objectCollision,
    };
  } finally {
    applyJointValues(robot, restoreJointValues, { filter: false });
    robot.updateMatrixWorld?.(true);
  }
};
