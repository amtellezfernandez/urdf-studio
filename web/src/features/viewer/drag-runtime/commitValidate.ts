import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { DragRuntimeCache, DragRuntimeConfig } from "./types";
import { evaluateFastSafety } from "./safetyFast";

type ValidateReleasePoseParams = {
  robot: URDFRobot | null;
  runtimeCache: DragRuntimeCache;
  baselineJointValues: Record<string, number>;
  endEffectorObject: THREE.Object3D | null;
  targetPositionWorld: THREE.Vector3 | null;
  lastSafeSolution: Record<string, number> | null;
  config: DragRuntimeConfig;
};

export const validateReleasePose = ({
  robot,
  runtimeCache,
  baselineJointValues,
  endEffectorObject,
  targetPositionWorld,
  lastSafeSolution,
  config,
}: ValidateReleasePoseParams): { correctedSolution: Record<string, number> | null; corrected: boolean } => {
  if (!robot || !targetPositionWorld) {
    return { correctedSolution: null, corrected: false };
  }

  const releaseSafety = evaluateFastSafety({
    robot,
    runtimeCache,
    candidateTargets: {},
    baselineJointValues,
    endEffectorObject,
    targetPositionWorld,
    config: {
      ...config,
      fastCollisionTolerance: config.releaseCollisionTolerance,
      fastFloorToleranceM: config.releaseFloorToleranceM,
    },
  });
  const releaseSafe =
    releaseSafety.collisionPairs <= config.releaseCollisionTolerance &&
    releaseSafety.floorPenetration <= config.releaseFloorToleranceM;
  if (releaseSafe) {
    return { correctedSolution: null, corrected: false };
  }

  if (lastSafeSolution && Object.keys(lastSafeSolution).length > 0) {
    return { correctedSolution: lastSafeSolution, corrected: true };
  }

  return { correctedSolution: null, corrected: false };
};

