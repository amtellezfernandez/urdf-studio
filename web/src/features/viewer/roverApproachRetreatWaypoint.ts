import * as THREE from "three";

import type { CreatedObject } from "@/features/objects";
import { resolveWorldObjectGeometry } from "@/features/objects/worldObjectGeometry";
import {
  resolveApproachObjectPrimitiveType,
  resolveRoverApproachFootprintSupportRadiusM,
  resolveRoverPlanarObjectApproachDistance,
  type RoverApproachRobotFootprint,
} from "@/features/locomotion/approach";
import { ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS } from "@/features/viewer/roverApproachBeforeIkSolveParams";
import { resolveRoverApproachCollisionPathClearanceM } from "@/features/viewer/roverApproachCollisionClearance";
import type { RoverApproachRetreatWaypoint } from "@/features/viewer/roverApproachRouteState";

const resolvePlanarDirectionOrFallback = ({
  directionWorld,
  upAxisWorld,
  fallbackWorld,
}: {
  directionWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  fallbackWorld: THREE.Vector3;
}): THREE.Vector3 => {
  const planarDirectionWorld = directionWorld
    .clone()
    .addScaledVector(upAxisWorld, -directionWorld.dot(upAxisWorld));
  if (
    planarDirectionWorld.lengthSq() <=
    ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.retreatDirectionLengthEpsilonSq
  ) {
    return fallbackWorld.clone();
  }
  return planarDirectionWorld.normalize();
};

export const resolveRoverApproachRetreatWaypoint = ({
  basePositionWorld,
  targetObjectId,
  worldObjects,
  upAxisWorld,
  forwardWorld,
  roverBaseRadiusM,
  robotFootprint,
}: {
  basePositionWorld: THREE.Vector3;
  targetObjectId: string;
  worldObjects: readonly CreatedObject[];
  upAxisWorld: THREE.Vector3;
  forwardWorld: THREE.Vector3;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
}): RoverApproachRetreatWaypoint | null => {
  const fallbackRetreatDirectionWorld = resolvePlanarDirectionOrFallback({
    directionWorld: forwardWorld.clone().multiplyScalar(-1),
    upAxisWorld,
    fallbackWorld: new THREE.Vector3(1, 0, 0),
  });
  let bestRetreatWaypoint: RoverApproachRetreatWaypoint | null = null;

  for (const worldObject of worldObjects) {
    if (worldObject.id === targetObjectId || worldObject.isHidden === true) {
      continue;
    }
    const objectGeometry = resolveWorldObjectGeometry(worldObject);
    const baseOffsetWorld = basePositionWorld.clone().sub(objectGeometry.position);
    const retreatDirectionWorld = resolvePlanarDirectionOrFallback({
      directionWorld: baseOffsetWorld,
      upAxisWorld,
      fallbackWorld: fallbackRetreatDirectionWorld,
    });
    const baseOffsetPlanarWorld = baseOffsetWorld
      .clone()
      .addScaledVector(upAxisWorld, -baseOffsetWorld.dot(upAxisWorld));
    const resolvedTargetDirectionPlanarWorld =
      baseOffsetPlanarWorld.lengthSq() <=
      ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.retreatDirectionLengthEpsilonSq
        ? retreatDirectionWorld
        : baseOffsetPlanarWorld;
    const approachDistance = resolveRoverPlanarObjectApproachDistance({
      object: {
        type: resolveApproachObjectPrimitiveType(worldObject.type),
        size: objectGeometry.size,
        rotation: worldObject.rotation,
      },
      targetDirectionPlanarWorld: resolvedTargetDirectionPlanarWorld,
    });
    const robotSupportRadiusM = Math.max(
      roverBaseRadiusM,
      resolveRoverApproachFootprintSupportRadiusM({
        robotFootprint,
        forwardWorld,
        upAxisWorld,
        targetDirectionWorld: retreatDirectionWorld,
      })
    );
    const requiredClearanceM =
      approachDistance.supportRadiusM +
      robotSupportRadiusM +
      resolveRoverApproachCollisionPathClearanceM({ useCase: "retreat-overlap" });
    const overlapDepthM =
      requiredClearanceM - resolvedTargetDirectionPlanarWorld.length();
    if (
      overlapDepthM <=
      ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.retreatOverlapEpsilonM
    ) {
      continue;
    }
    const retreatDistanceM =
      overlapDepthM + ROVER_APPROACH_BEFORE_IK_SOLVE_PARAMS.retreatExtraDistanceM;
    const retreatWaypoint: RoverApproachRetreatWaypoint = {
      waypointWorld: basePositionWorld
        .clone()
        .addScaledVector(retreatDirectionWorld, retreatDistanceM),
      excludedObstacleId: worldObject.id,
      retreatDistanceM,
    };
    if (
      bestRetreatWaypoint === null ||
      retreatWaypoint.retreatDistanceM > bestRetreatWaypoint.retreatDistanceM
    ) {
      bestRetreatWaypoint = retreatWaypoint;
    }
  }

  return bestRetreatWaypoint;
};
