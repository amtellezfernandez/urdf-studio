import * as THREE from "three";

export const buildRoverNavigationPreviewPoints = ({
  segmentStartWorld,
  waypointWorlds,
  finalNavigationGoalWorld,
}: {
  segmentStartWorld: THREE.Vector3;
  waypointWorlds: readonly THREE.Vector3[];
  finalNavigationGoalWorld: THREE.Vector3;
}): THREE.Vector3[] => [
  segmentStartWorld.clone(),
  ...waypointWorlds.map((waypointWorld) => waypointWorld.clone()),
  finalNavigationGoalWorld.clone(),
];

export const cloneRoverNavigationWaypointWorlds = ({
  routePointWorlds,
}: {
  routePointWorlds: readonly THREE.Vector3[];
}): THREE.Vector3[] =>
  routePointWorlds.length > 2
    ? routePointWorlds
        .slice(1, routePointWorlds.length - 1)
        .map((pointWorld) => pointWorld.clone())
    : [];
