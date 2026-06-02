import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import { applyJointValues } from "@/shared/lib/urdf-joints";
import type { DragRuntimeCache, DragRuntimeConfig, FastSafetyResult } from "./types";
import { toLinkPairKey } from "./cache";

const WHEEL_JOINT_PATTERN = /(wheel|tire|caster|drive)/i;

const filterSolutionToChain = (
  solution: Record<string, number>,
  chainJointNames: Set<string> | null
) => {
  if (!chainJointNames || chainJointNames.size === 0) {
    return solution;
  }
  const filtered: Record<string, number> = {};
  Object.entries(solution).forEach(([jointName, value]) => {
    if (chainJointNames.has(jointName)) {
      filtered[jointName] = value;
    }
  });
  return Object.keys(filtered).length > 0 ? filtered : solution;
};

const stripWheelJoints = (solution: Record<string, number>) => {
  const filtered: Record<string, number> = {};
  Object.entries(solution).forEach(([jointName, value]) => {
    if (WHEEL_JOINT_PATTERN.test(jointName)) return;
    filtered[jointName] = value;
  });
  return filtered;
};

type EvaluateFastSafetyParams = {
  robot: URDFRobot | null;
  runtimeCache: DragRuntimeCache;
  candidateTargets: Record<string, number>;
  baselineJointValues: Record<string, number>;
  endEffectorObject: THREE.Object3D | null;
  targetPositionWorld?: THREE.Vector3;
  config: DragRuntimeConfig;
};

export const evaluateFastSafety = ({
  robot,
  runtimeCache,
  candidateTargets,
  baselineJointValues,
  endEffectorObject,
  targetPositionWorld,
  config,
}: EvaluateFastSafetyParams): FastSafetyResult => {
  if (!robot) {
    return {
      safe: true,
      floorClear: true,
      floorPenetration: 0,
      collisionPairs: 0,
      eeDistance: Number.POSITIVE_INFINITY,
    };
  }

  const restoreTargets: Record<string, number> = {};
  Object.entries(candidateTargets).forEach(([jointName, nextValue]) => {
    if (!Number.isFinite(nextValue)) return;
    const current = baselineJointValues[jointName];
    if (Number.isFinite(current)) {
      restoreTargets[jointName] = current;
    }
  });

  try {
    if (Object.keys(candidateTargets).length > 0) {
      applyJointValues(robot, candidateTargets, { filter: false });
      robot.updateMatrixWorld(true);
    }

    const spheresByLink = new Map<string, { center: THREE.Vector3; radius: number }>();
    let minWorldZ = Number.POSITIVE_INFINITY;
    const tmpWorldCenter = new THREE.Vector3();
    const tmpScale = new THREE.Vector3();
    const tmpDelta = new THREE.Vector3();

    runtimeCache.collisionProxies.forEach((proxy) => {
      tmpWorldCenter.copy(proxy.localSphereCenter).applyMatrix4(proxy.mesh.matrixWorld);
      tmpScale.setFromMatrixScale(proxy.mesh.matrixWorld);
      const maxScale = Math.max(
        Math.abs(tmpScale.x),
        Math.abs(tmpScale.y),
        Math.abs(tmpScale.z),
        1e-6
      );
      const radius = proxy.localSphereRadius * maxScale;
      const current = spheresByLink.get(proxy.linkName);
      if (!current) {
        spheresByLink.set(proxy.linkName, {
          center: tmpWorldCenter.clone(),
          radius,
        });
      } else {
        tmpDelta.copy(tmpWorldCenter).sub(current.center);
        const distance = tmpDelta.length();
        if (distance + radius <= current.radius) {
          // Existing aggregate contains candidate.
        } else if (distance + current.radius <= radius) {
          current.center.copy(tmpWorldCenter);
          current.radius = radius;
        } else if (distance > 1e-9) {
          const newRadius = (current.radius + distance + radius) * 0.5;
          current.center.addScaledVector(tmpDelta.multiplyScalar(1 / distance), newRadius - current.radius);
          current.radius = newRadius;
        } else {
          current.radius = Math.max(current.radius, radius);
        }
      }
      minWorldZ = Math.min(minWorldZ, tmpWorldCenter.z - radius);
    });

    const floorClear = Number.isFinite(minWorldZ) && minWorldZ >= config.floorZ - config.floorEpsilon;
    const floorPenetration = Number.isFinite(minWorldZ) ? Math.max(0, config.floorZ - minWorldZ) : 0;

    const linkNames = Array.from(spheresByLink.keys());
    let collisionPairs = 0;
    for (let i = 0; i < linkNames.length; i += 1) {
      for (let j = i + 1; j < linkNames.length; j += 1) {
        const linkA = linkNames[i];
        const linkB = linkNames[j];
        if (linkA === linkB) continue;
        if (runtimeCache.adjacentLinkPairs.has(toLinkPairKey(linkA, linkB))) continue;
        const sphereA = spheresByLink.get(linkA);
        const sphereB = spheresByLink.get(linkB);
        if (!sphereA || !sphereB) continue;
        const centerDistance = sphereA.center.distanceTo(sphereB.center);
        if (centerDistance + config.collisionMargin < sphereA.radius + sphereB.radius) {
          collisionPairs += 1;
        }
      }
    }

    let eeDistance = Number.POSITIVE_INFINITY;
    if (targetPositionWorld && endEffectorObject) {
      const eePosition = new THREE.Vector3();
      endEffectorObject.updateMatrixWorld(true);
      endEffectorObject.getWorldPosition(eePosition);
      eeDistance = eePosition.distanceTo(targetPositionWorld);
    }

    return {
      safe: floorClear && collisionPairs === 0,
      floorClear,
      floorPenetration,
      collisionPairs,
      eeDistance,
    };
  } catch {
    return {
      safe: true,
      floorClear: true,
      floorPenetration: 0,
      collisionPairs: 0,
      eeDistance: Number.POSITIVE_INFINITY,
    };
  } finally {
    if (Object.keys(restoreTargets).length > 0) {
      applyJointValues(robot, restoreTargets, { filter: false });
      robot.updateMatrixWorld(true);
    }
  }
};

type SelectBestFastCandidateParams = {
  rawSolution: Record<string, number>;
  runtimeCache: DragRuntimeCache;
  wheelDriveEnabled: boolean;
  baselineJointValues: Record<string, number>;
  lastSafeSolution: Record<string, number> | null;
  lastSafeTargetWorld: THREE.Vector3 | null;
  targetPositionWorld: THREE.Vector3;
  robot: URDFRobot | null;
  endEffectorObject: THREE.Object3D | null;
  config: DragRuntimeConfig;
};

export const selectBestFastCandidate = ({
  rawSolution,
  runtimeCache,
  wheelDriveEnabled,
  baselineJointValues,
  lastSafeSolution,
  lastSafeTargetWorld,
  targetPositionWorld,
  robot,
  endEffectorObject,
  config,
}: SelectBestFastCandidateParams): Record<string, number> | null => {
  const chainFiltered = filterSolutionToChain(rawSolution, runtimeCache.chainJointNames);
  const wheelFiltered = wheelDriveEnabled ? chainFiltered : stripWheelJoints(chainFiltered);
  const candidateBase =
    Object.keys(wheelFiltered).length > 0 ? wheelFiltered : chainFiltered;
  if (Object.keys(candidateBase).length === 0) return null;

  const baseline = {
    ...baselineJointValues,
    ...(lastSafeSolution ?? {}),
  };
  const targetMovement = lastSafeTargetWorld?.distanceTo(targetPositionWorld) ?? Number.POSITIVE_INFINITY;
  const maxAllowedJump = targetMovement < 0.03 ? 0.35 : targetMovement < 0.08 ? 0.65 : 1.2;

  let maxDelta = 0;
  Object.entries(candidateBase).forEach(([jointName, value]) => {
    const base = baseline[jointName];
    if (!Number.isFinite(base) || !Number.isFinite(value)) return;
    maxDelta = Math.max(maxDelta, Math.abs((value as number) - base));
  });
  const jumpScale = maxDelta > maxAllowedJump ? maxAllowedJump / maxDelta : 1;
  const baselineSafety = evaluateFastSafety({
    robot,
    runtimeCache,
    candidateTargets: {},
    baselineJointValues,
    endEffectorObject,
    targetPositionWorld,
    config,
  });

  const maxCollisionPairs = baselineSafety.collisionPairs + config.fastCollisionTolerance;
  const maxFloorPenetration = baselineSafety.floorPenetration + config.fastFloorToleranceM;
  const scales = maxDelta > 0.45 ? [1, 0.72, 0.5, 0.34, 0.2, 0.1, 0] : [1, 0.82, 0.62, 0.44, 0.28, 0.14, 0];
  let best: { solution: Record<string, number>; score: number } | null = null;

  for (const scale of scales) {
    const totalScale = jumpScale * scale;
    const blended: Record<string, number> = {};
    Object.entries(candidateBase).forEach(([jointName, value]) => {
      const base = Number.isFinite(baseline[jointName]) ? baseline[jointName] : (value as number);
      blended[jointName] = base + ((value as number) - base) * totalScale;
    });

    const safety = evaluateFastSafety({
      robot,
      runtimeCache,
      candidateTargets: blended,
      baselineJointValues,
      endEffectorObject,
      targetPositionWorld,
      config,
    });
    if (safety.collisionPairs > maxCollisionPairs) continue;
    if (safety.floorPenetration > maxFloorPenetration) continue;

    let regularization = 0;
    Object.entries(blended).forEach(([jointName, value]) => {
      const base = baseline[jointName];
      if (!Number.isFinite(base) || !Number.isFinite(value)) return;
      regularization += Math.abs((value as number) - base);
    });
    const collisionPenalty = Math.max(0, safety.collisionPairs - baselineSafety.collisionPairs);
    const floorPenalty = Math.max(0, safety.floorPenetration - baselineSafety.floorPenetration);
    const score =
      safety.eeDistance +
      regularization * 0.015 +
      collisionPenalty * 0.06 +
      floorPenalty * 2.5;
    if (!best || score < best.score) {
      best = {
        solution: blended,
        score,
      };
    }
  }

  return best?.solution ?? null;
};
