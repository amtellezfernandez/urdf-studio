import * as THREE from "three";

import type { WorldObjectObstacleSource } from "./approachObstacleProjection";
import type { RoverApproachRobotFootprint } from "./approachNavigation";

export type RoverNavigationSceneObservationMode = "fully-observed" | "partially-observed";

export type RoverNavigationSceneLayerKind =
  | "observed-free"
  | "static-obstacle"
  | "inflated-obstacle"
  | "unknown";

export type RoverNavigationSceneLayerSummary = {
  kind: RoverNavigationSceneLayerKind;
  obstacleCount: number;
};

export type RoverNavigationSceneSummary = {
  sourceObjectCount: number;
  hiddenObjectCount: number;
  obstacleCount: number;
  observationMode: RoverNavigationSceneObservationMode;
  layers: RoverNavigationSceneLayerSummary[];
};

export type RoverNavigationIntentTargetKind = "position" | "object-contact";

export type RoverNavigationIntent = {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  excludedObstacleIds: string[];
  targetKind: RoverNavigationIntentTargetKind;
};

export type RoverNavigationPlannerStage =
  | "direct"
  | "visibility"
  | "grid"
  | "detour"
  | "blocked";

export type RoverNavigationBlockedReason =
  | "none"
  | "start-in-collision"
  | "goal-in-collision"
  | "scene-projection-invalid"
  | "route-validation-failed"
  | "no-traversable-corridor";

export type RoverNavigationPlanSummary = {
  mode: "direct" | "path" | "blocked";
  plannerStage: RoverNavigationPlannerStage;
  blockedReason: RoverNavigationBlockedReason;
  minimumClearanceM: number | null;
  waypointCount: number;
};

export const buildRoverNavigationSceneSummary = ({
  objects,
  obstacleCount,
}: {
  objects: readonly WorldObjectObstacleSource[];
  obstacleCount: number;
}): RoverNavigationSceneSummary => {
  const hiddenObjectCount = objects.filter((object) => object.isHidden === true).length;
  const staticObstacleCount = obstacleCount;
  return {
    sourceObjectCount: objects.length,
    hiddenObjectCount,
    obstacleCount,
    observationMode: "fully-observed",
    layers: [
      { kind: "observed-free", obstacleCount: 0 },
      { kind: "static-obstacle", obstacleCount: staticObstacleCount },
      { kind: "inflated-obstacle", obstacleCount: staticObstacleCount },
      { kind: "unknown", obstacleCount: 0 },
    ],
  };
};

export const buildRoverNavigationIntent = ({
  segmentStartWorld,
  segmentEndWorld,
  upAxisWorld,
  roverBaseRadiusM,
  robotFootprint,
  excludedObstacleIds,
  isObjectContactTarget,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  excludedObstacleIds: readonly string[];
  isObjectContactTarget: boolean;
}): RoverNavigationIntent => ({
  segmentStartWorld: segmentStartWorld.clone(),
  segmentEndWorld: segmentEndWorld.clone(),
  upAxisWorld: upAxisWorld.clone(),
  roverBaseRadiusM,
  robotFootprint,
  excludedObstacleIds: [...excludedObstacleIds],
  targetKind: isObjectContactTarget ? "object-contact" : "position",
});
