import * as THREE from "three";
import { projectVectorOntoPlane } from "@/shared/lib/axisFrame";
import { ROVER_APPROACH_CONFIG } from "./approachParams";
import { computeSignedPlanarYawErrorRad } from "./approachExecutor";

export const resolveRoverApproachLockedGoalState = ({
  basePositionWorld,
  navigationGoalWorld,
  facingTargetWorld = null,
  facingDirectionWorld = null,
  forwardWorld,
  upAxisWorld,
}: {
  basePositionWorld: THREE.Vector3;
  navigationGoalWorld: THREE.Vector3;
  facingTargetWorld?: THREE.Vector3 | null;
  facingDirectionWorld?: THREE.Vector3 | null;
  forwardWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
}) => {
  const toNavigationGoalPlanarWorld = projectVectorOntoPlane(
    navigationGoalWorld.clone().sub(basePositionWorld),
    upAxisWorld
  );
  const distanceToGoalM = toNavigationGoalPlanarWorld.length();
  const facingDirectionSourceWorld =
    facingDirectionWorld?.clone() ??
    (facingTargetWorld ? facingTargetWorld.clone().sub(basePositionWorld) : null);
  if (!facingDirectionSourceWorld) {
    return {
      distanceToGoalM,
      yawErrorRad: 0,
      forwardDotFacingTarget: 1,
    };
  }
  const toFacingTargetPlanarWorld = projectVectorOntoPlane(
    facingDirectionSourceWorld,
    upAxisWorld
  );
  if (
    toFacingTargetPlanarWorld.lengthSq() <= ROVER_APPROACH_CONFIG.planarDirectionLengthEpsilonSq
  ) {
    return {
      distanceToGoalM,
      yawErrorRad: 0,
      forwardDotFacingTarget: 1,
    };
  }
  const normalizedFacingDirectionWorld = toFacingTargetPlanarWorld.normalize();
  return {
    distanceToGoalM,
    yawErrorRad: computeSignedPlanarYawErrorRad(
      forwardWorld,
      normalizedFacingDirectionWorld,
      upAxisWorld
    ),
    forwardDotFacingTarget: forwardWorld.dot(normalizedFacingDirectionWorld),
  };
};
