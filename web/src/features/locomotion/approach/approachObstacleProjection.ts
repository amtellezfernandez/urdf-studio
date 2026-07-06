import * as THREE from "three";

import { resolveWorldObjectGeometry, type WorldObjectPrimitiveType } from "@/features/objects";
import { isFiniteNumber, isFinitePositiveNumber } from "@/shared/lib/numeric";
import {
  resolvePlanarProjectedObstacleRadiusM,
  type RoverApproachPlanarObstacle,
} from "./approachDetour";
import { resolveApproachObjectPrimitiveType } from "./approachObjectDistance";

export type WorldObjectObstacleSource = {
  id: string;
  type: WorldObjectPrimitiveType;
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  size: THREE.Vector3;
  isHidden?: boolean;
};

const hasFiniteVector3Components = (value: THREE.Vector3): boolean =>
  isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);

const isVisibleWorldObject = (object: WorldObjectObstacleSource): boolean =>
  object.isHidden !== true;

const buildPlanarObstacle = (
  object: WorldObjectObstacleSource,
  upAxisWorld: THREE.Vector3
): RoverApproachPlanarObstacle => {
  const geometry = resolveWorldObjectGeometry(object);
  return {
    id: object.id,
    primitiveType: resolveApproachObjectPrimitiveType(object.type),
    centerWorld: geometry.position,
    radiusM: resolvePlanarProjectedObstacleRadiusM({
      halfExtentsWorld: geometry.size.clone().multiplyScalar(0.5),
      upAxisWorld,
    }),
    rotationWorld: object.rotation?.clone() ?? null,
    sizeWorld: geometry.size.clone(),
  };
};

const isUsablePlanarObstacle = (obstacle: RoverApproachPlanarObstacle): boolean =>
  hasFiniteVector3Components(obstacle.centerWorld) && isFinitePositiveNumber(obstacle.radiusM);

export const buildRoverApproachPlanarObstacles = ({
  objects,
  upAxisWorld,
}: {
  objects: WorldObjectObstacleSource[];
  upAxisWorld: THREE.Vector3;
}): RoverApproachPlanarObstacle[] =>
  objects
    .filter(isVisibleWorldObject)
    .map((object) => buildPlanarObstacle(object, upAxisWorld))
    .filter(isUsablePlanarObstacle);
