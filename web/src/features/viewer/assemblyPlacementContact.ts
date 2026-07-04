import * as THREE from "three";
import type { URDFJoint, URDFRobot } from "urdf-loader";

import { buildContactPairKey } from "@/features/assembly/store/useAssemblyPlacementStore";
import { ASSEMBLY_PLACEMENT_CONTACT_PARAMS } from "@/features/viewer/assemblyPlacementContactParams";

export type AssemblyMeshProxy = {
  mesh: THREE.Mesh;
  localBounds: THREE.Box3;
};

export type AssemblyWheelJoint = {
  jointName: string;
  joint: URDFJoint;
  axisLocal: THREE.Vector3;
  radius: number;
  directionSign: number;
};

export type AssemblyWheelProfile = {
  forwardLocal: THREE.Vector3;
  wheels: AssemblyWheelJoint[];
};

export type AssemblyPlacementRobot = {
  id: string;
  robot: URDFRobot;
  radius: number;
  halfExtentX: number;
  halfExtentZ: number;
  meshProxies: AssemblyMeshProxy[];
  wheelProfile: AssemblyWheelProfile | null;
};

export type AssemblyContactMetric = {
  dx: number;
  dz: number;
  distance: number;
  targetDistance: number;
  gap: number;
  absGap: number;
  targetX: number;
  targetZ: number;
  axisMode: "x" | "z" | "free";
  meshGap: number;
};

export type AssemblyContactSnapResult =
  | { snapped: false }
  | {
      snapped: true;
      otherId: string;
      absGap: number;
      targetX: number;
      targetZ: number;
    };

const safeAssemblyDirectionSign = (value: number, fallback: number): 1 | -1 => {
  if (Math.abs(value) > ASSEMBLY_PLACEMENT_CONTACT_PARAMS.directionEpsilonM) {
    return value > 0 ? 1 : -1;
  }
  return fallback >= 0 ? 1 : -1;
};

export const computeAssemblyMeshContactGap = (
  lhs: AssemblyPlacementRobot,
  rhs: AssemblyPlacementRobot
): number => {
  const rhsBoxes = rhs.meshProxies.map((proxy) =>
    proxy.localBounds.clone().applyMatrix4(proxy.mesh.matrixWorld)
  );
  if (rhsBoxes.length === 0) return Number.POSITIVE_INFINITY;
  let minGap = Number.POSITIVE_INFINITY;
  lhs.meshProxies.forEach((lhsProxy) => {
    const lhsBox = lhsProxy.localBounds.clone().applyMatrix4(lhsProxy.mesh.matrixWorld);
    rhsBoxes.forEach((rhsBox) => {
      const dx = Math.max(lhsBox.min.x - rhsBox.max.x, rhsBox.min.x - lhsBox.max.x, 0);
      const dy = Math.max(lhsBox.min.y - rhsBox.max.y, rhsBox.min.y - lhsBox.max.y, 0);
      const dz = Math.max(lhsBox.min.z - rhsBox.max.z, rhsBox.min.z - lhsBox.max.z, 0);
      const gap = Math.hypot(dx, dy, dz);
      if (gap < minGap) {
        minGap = gap;
      }
    });
  });
  return minGap;
};

const computeAssemblyDirectionalFootprintSupport = (
  entry: AssemblyPlacementRobot,
  dirX: number,
  dirZ: number
): number => {
  if (entry.meshProxies.length === 0) {
    const yaw = entry.robot.rotation.y;
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    const localX = dirX * cos - dirZ * sin;
    const localZ = dirX * sin + dirZ * cos;
    return Math.abs(localX) * entry.halfExtentX + Math.abs(localZ) * entry.halfExtentZ;
  }
  const robotPosition = entry.robot.position;
  let support = 0;
  entry.meshProxies.forEach((proxy) => {
    const worldBox = proxy.localBounds.clone().applyMatrix4(proxy.mesh.matrixWorld);
    const centerX = (worldBox.min.x + worldBox.max.x) * 0.5;
    const centerZ = (worldBox.min.z + worldBox.max.z) * 0.5;
    const halfX = (worldBox.max.x - worldBox.min.x) * 0.5;
    const halfZ = (worldBox.max.z - worldBox.min.z) * 0.5;
    const projectedCenter = (centerX - robotPosition.x) * dirX + (centerZ - robotPosition.z) * dirZ;
    const projectedHalf = Math.abs(dirX) * halfX + Math.abs(dirZ) * halfZ;
    support = Math.max(support, projectedCenter + projectedHalf);
  });
  return Math.max(support, ASSEMBLY_PLACEMENT_CONTACT_PARAMS.minDirectionalSupportM);
};

export const computeAssemblyContactMetric = (
  lhs: AssemblyPlacementRobot,
  rhs: AssemblyPlacementRobot
): AssemblyContactMetric => {
  lhs.robot.updateMatrixWorld(true);
  rhs.robot.updateMatrixWorld(true);
  const rawDx = lhs.robot.position.x - rhs.robot.position.x;
  const rawDz = lhs.robot.position.z - rhs.robot.position.z;
  const baseDistance = Math.hypot(rawDx, rawDz);
  const fallbackX = Math.cos(lhs.robot.rotation.y);
  const fallbackZ = Math.sin(lhs.robot.rotation.y);
  let dirX =
    baseDistance > ASSEMBLY_PLACEMENT_CONTACT_PARAMS.directionEpsilonM
      ? rawDx / baseDistance
      : safeAssemblyDirectionSign(rawDx, fallbackX);
  let dirZ =
    baseDistance > ASSEMBLY_PLACEMENT_CONTACT_PARAMS.directionEpsilonM
      ? rawDz / baseDistance
      : safeAssemblyDirectionSign(rawDz, fallbackZ);
  let axisMode: AssemblyContactMetric["axisMode"] = "free";
  const absDx = Math.abs(rawDx);
  const absDz = Math.abs(rawDz);
  if (
    absDz <= ASSEMBLY_PLACEMENT_CONTACT_PARAMS.axisSnapToleranceM ||
    (absDz <= ASSEMBLY_PLACEMENT_CONTACT_PARAMS.axisAssistRangeM &&
      absDz < absDx * ASSEMBLY_PLACEMENT_CONTACT_PARAMS.axisAssistDominanceRatio)
  ) {
    dirX = safeAssemblyDirectionSign(rawDx, fallbackX);
    dirZ = 0;
    axisMode = "x";
  } else if (
    absDx <= ASSEMBLY_PLACEMENT_CONTACT_PARAMS.axisSnapToleranceM ||
    (absDx <= ASSEMBLY_PLACEMENT_CONTACT_PARAMS.axisAssistRangeM &&
      absDx < absDz * ASSEMBLY_PLACEMENT_CONTACT_PARAMS.axisAssistDominanceRatio)
  ) {
    dirX = 0;
    dirZ = safeAssemblyDirectionSign(rawDz, fallbackZ);
    axisMode = "z";
  }
  const lhsSupport = computeAssemblyDirectionalFootprintSupport(lhs, dirX, dirZ);
  const rhsSupport = computeAssemblyDirectionalFootprintSupport(rhs, -dirX, -dirZ);
  const targetDistance = lhsSupport + rhsSupport;
  const distance = axisMode === "x" ? absDx : axisMode === "z" ? absDz : baseDistance;
  const estimatedGap = distance - targetDistance;
  let meshGap = Number.POSITIVE_INFINITY;
  if (
    baseDistance <=
    lhs.radius + rhs.radius + ASSEMBLY_PLACEMENT_CONTACT_PARAMS.meshContactDistanceLimitM
  ) {
    meshGap = computeAssemblyMeshContactGap(lhs, rhs);
  }
  const gap = Number.isFinite(meshGap) ? meshGap : estimatedGap;
  return {
    dx: rawDx,
    dz: rawDz,
    distance,
    targetDistance,
    gap,
    absGap: Math.abs(gap),
    targetX: rhs.robot.position.x + dirX * targetDistance,
    targetZ: rhs.robot.position.z + dirZ * targetDistance,
    axisMode,
    meshGap,
  };
};

export const computeAssemblyContactPairs = (
  robots: readonly AssemblyPlacementRobot[]
): string[] => {
  const pairs: string[] = [];
  for (let i = 0; i < robots.length; i += 1) {
    for (let j = i + 1; j < robots.length; j += 1) {
      const lhs = robots[i];
      const rhs = robots[j];
      const metric = computeAssemblyContactMetric(lhs, rhs);
      if (metric.gap <= ASSEMBLY_PLACEMENT_CONTACT_PARAMS.contactDetectionToleranceM) {
        pairs.push(buildContactPairKey(lhs.id, rhs.id));
      }
    }
  }
  return pairs;
};

export const resolveAssemblyNearestContactSnap = (
  robots: readonly AssemblyPlacementRobot[],
  robotId: string,
  options?: { maxGap?: number; preferOtherId?: string | null }
): AssemblyContactSnapResult => {
  if (robots.length < 2) return { snapped: false };
  const target = robots.find((item) => item.id === robotId);
  if (!target) return { snapped: false };

  let best:
    | {
        other: AssemblyPlacementRobot;
        metric: AssemblyContactMetric;
        score: number;
      }
    | null = null;

  robots.forEach((other) => {
    if (other.id === robotId) return;
    const metric = computeAssemblyContactMetric(target, other);
    const preferenceBias =
      options?.preferOtherId && options.preferOtherId === other.id
        ? ASSEMBLY_PLACEMENT_CONTACT_PARAMS.preferredContactScoreBias
        : 0;
    const axisBonus =
      metric.axisMode !== "free" ? ASSEMBLY_PLACEMENT_CONTACT_PARAMS.axisContactScoreBias : 0;
    const score = metric.absGap + preferenceBias + axisBonus;
    if (!best || score < best.score) {
      best = { other, metric, score };
    }
  });

  if (!best) return { snapped: false };
  const maxGap = options?.maxGap;
  if (typeof maxGap === "number" && best.metric.absGap > maxGap) {
    return { snapped: false };
  }

  return {
    snapped: true,
    otherId: best.other.id,
    absGap: best.metric.absGap,
    targetX: best.metric.targetX,
    targetZ: best.metric.targetZ,
  };
};
