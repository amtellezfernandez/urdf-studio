import * as THREE from "three";
import { ROVER_APPROACH_GUIDE_PARAMS } from "@/features/viewer/roverApproachGuideParams";

const DEFAULT_WORLD_UP_AXIS = new THREE.Vector3(0, 0, 1);


export const resolveRoverApproachRoutePreviewPoints = ({
  pointWorlds,
  upAxisWorld,
}: {
  pointWorlds: readonly THREE.Vector3[];
  upAxisWorld: THREE.Vector3;
}): THREE.Vector3[] => {
  const normalizedUpAxis =
    upAxisWorld.lengthSq() > 1e-10
      ? upAxisWorld.clone().normalize()
      : DEFAULT_WORLD_UP_AXIS.clone();
  return pointWorlds.map((pointWorld) =>
    pointWorld
      .clone()
      .addScaledVector(normalizedUpAxis, ROVER_APPROACH_GUIDE_PARAMS.routeLiftMeters)
  );
};
