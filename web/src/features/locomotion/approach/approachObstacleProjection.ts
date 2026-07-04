import * as THREE from "three";

import { resolveWorldObjectGeometry, type WorldObjectPrimitiveType } from "@/features/objects";
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

const hasFiniteVector3 = (value: THREE.Vector3): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);

export const buildRoverApproachPlanarObstacles = ({
  objects,
  upAxisWorld,
}: {
  objects: WorldObjectObstacleSource[];
  upAxisWorld: THREE.Vector3;
}): RoverApproachPlanarObstacle[] =>
  objects
    .filter((object) => object.isHidden !== true)
    .map((object) => {
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
    })
    .filter(
      (obstacle) =>
        hasFiniteVector3(obstacle.centerWorld) &&
        Number.isFinite(obstacle.radiusM) &&
        obstacle.radiusM > 0
    );
