import * as THREE from "three";

import type { CreatedObject } from "@/features/objects";
import {
  ROVER_APPROACH_CONFIG,
  assessRoverApproachWorldSegmentClearance,
  buildRoverApproachWorldNavigationContext,
  type RoverApproachRobotFootprint,
  type RoverApproachStepPhase,
} from "@/features/locomotion/approach";
import { ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS } from "@/features/viewer/roverApproachBeforeIkSolveParams";
import type { RoverApproachWaypointLeg } from "@/features/viewer/roverApproachRouteState";

export const resolveRoverApproachCollisionPathClearanceM = ({
  useCase,
}: {
  useCase: "retreat-overlap" | "runtime-stop";
}): number =>
  useCase === "runtime-stop"
    ? ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.runtimeCollisionStopClearanceM
    : ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.retreatCollisionPathClearanceM;

const resolveRoverApproachRuntimeCollisionSampleCount = ({
  linearTravelM,
  angularTravelRad,
}: {
  linearTravelM: number;
  angularTravelRad: number;
}): number =>
  Math.max(
    1,
    Math.ceil(
      Math.max(0, Math.abs(linearTravelM)) /
        ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.runtimeCollisionSampleLinearStepM
    ),
    Math.ceil(
      Math.max(0, Math.abs(angularTravelRad)) /
        ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.runtimeCollisionSampleAngularStepRad
    )
  );

const resolveRoverApproachRuntimeCollisionSampleForwardWorld = ({
  forwardWorld,
  nextForwardWorld,
  sampleT,
}: {
  forwardWorld: THREE.Vector3;
  nextForwardWorld: THREE.Vector3;
  sampleT: number;
}): THREE.Vector3 => {
  const sampleForwardWorld = forwardWorld.clone().lerp(nextForwardWorld, sampleT);
  return sampleForwardWorld.lengthSq() > 0
    ? sampleForwardWorld.normalize()
    : nextForwardWorld.clone().normalize();
};

export const resolveRoverApproachRuntimeCollisionAssessment = ({
  basePositionWorld,
  nextBasePositionWorld,
  forwardWorld,
  nextForwardWorld,
  navigationContext,
  excludedObstacleId,
  robotFootprint,
}: {
  basePositionWorld: THREE.Vector3;
  nextBasePositionWorld: THREE.Vector3;
  forwardWorld: THREE.Vector3;
  nextForwardWorld: THREE.Vector3;
  navigationContext: ReturnType<typeof buildRoverApproachWorldNavigationContext>;
  excludedObstacleId?: string | null;
  robotFootprint?: RoverApproachRobotFootprint;
}): {
  isClear: boolean;
  sampleCount: number;
  safeMotionFraction: number;
  collisionMotionFraction: number;
  blockingObstacleId: string | null;
} => {
  const sampleCount = resolveRoverApproachRuntimeCollisionSampleCount({
    linearTravelM: basePositionWorld.distanceTo(nextBasePositionWorld),
    angularTravelRad: Math.acos(
      THREE.MathUtils.clamp(
        forwardWorld.clone().normalize().dot(nextForwardWorld.clone().normalize()),
        -1,
        1
      )
    ),
  });
  for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
    const sampleT = sampleIndex / sampleCount;
    const sampleBasePositionWorld = basePositionWorld.clone().lerp(
      nextBasePositionWorld,
      sampleT
    );
    const sampleForwardWorld = resolveRoverApproachRuntimeCollisionSampleForwardWorld({
      forwardWorld,
      nextForwardWorld,
      sampleT,
    });
    const sampleAssessment = assessRoverApproachWorldSegmentClearance({
      segmentStartWorld: sampleBasePositionWorld,
      segmentEndWorld: sampleBasePositionWorld,
      navigationContext,
      excludedObstacleId,
      robotFootprint,
      pathClearanceM: resolveRoverApproachCollisionPathClearanceM({ useCase: "runtime-stop" }),
      footprintForwardWorldStart: sampleForwardWorld,
      footprintForwardWorldEnd: sampleForwardWorld,
    });
    if (!sampleAssessment.isClear) {
      return {
        isClear: false,
        sampleCount,
        safeMotionFraction: (sampleIndex - 1) / sampleCount,
        collisionMotionFraction: sampleT,
        blockingObstacleId: sampleAssessment.firstBlockingObstacleId,
      };
    }
  }
  return {
    isClear: true,
    sampleCount,
    safeMotionFraction: 1,
    collisionMotionFraction: 1,
    blockingObstacleId: null,
  };
};

export const shouldTreatRuntimeCollisionAsReachedTarget = ({
  activeWaypointLeg,
  blockingObstacleId,
  isOrbitTarget,
  targetObjectId,
}: {
  activeWaypointLeg: RoverApproachWaypointLeg | null;
  blockingObstacleId: string | null;
  isOrbitTarget: boolean;
  targetObjectId: string;
}): boolean =>
  activeWaypointLeg === null &&
  !isOrbitTarget &&
  blockingObstacleId === targetObjectId;

export const resolveRoverApproachRuntimeCollisionAppliedMotionFraction = ({
  collisionAssessment,
}: {
  collisionAssessment: ReturnType<typeof resolveRoverApproachRuntimeCollisionAssessment>;
}): number => (collisionAssessment.isClear ? 1 : collisionAssessment.safeMotionFraction);

export const shouldFallbackToTurnInPlaceAfterRuntimeCollision = ({
  allowTranslationYawAssist,
  phase,
  linearTravelM,
  angularTravelRad,
}: {
  allowTranslationYawAssist: boolean;
  phase: RoverApproachStepPhase;
  linearTravelM: number;
  angularTravelRad: number;
}): boolean =>
  allowTranslationYawAssist &&
  phase === "translate" &&
  Math.abs(linearTravelM) > ROVER_APPROACH_CONFIG.appliedTravelEpsilon &&
  Math.abs(angularTravelRad) >
    ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.straightThroughTurnMaxRad;

const resolveRuntimeCollisionBlockingObjectLabel = ({
  worldObjects,
  blockingObstacleId,
}: {
  worldObjects: readonly CreatedObject[];
  blockingObstacleId: string | null;
}): string | null => {
  if (!blockingObstacleId) {
    return null;
  }
  const blockingObject = worldObjects.find((object) => object.id === blockingObstacleId);
  if (!blockingObject) {
    return blockingObstacleId;
  }
  const trimmedLabel = blockingObject.label?.trim() ?? "";
  return trimmedLabel.length > 0 ? trimmedLabel : blockingObject.id;
};

export const formatRoverApproachRuntimeCollisionDiagnostic = ({
  worldObjects,
  blockingObstacleId,
}: {
  worldObjects: readonly CreatedObject[];
  blockingObstacleId: string | null;
}): string => {
  const blockingObjectLabel = resolveRuntimeCollisionBlockingObjectLabel({
    worldObjects,
    blockingObstacleId,
  });
  return blockingObjectLabel
    ? `Rover approach blocked by ${blockingObjectLabel}`
    : "Rover approach blocked by live collision";
};
