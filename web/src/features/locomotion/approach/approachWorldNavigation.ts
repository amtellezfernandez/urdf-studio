import * as THREE from "three";
import { hashString } from "@/shared/lib/cache";
import { toVector3Tuple, type Vector3Tuple } from "@/shared/lib/vector3Tuple";

import { ROVER_APPROACH_DETOUR_CONFIG } from "./approachDetourParams";
import {
  resolveRoverApproachDetourWaypoint,
  type RoverApproachPlanarObstacle,
} from "./approachDetour";
import {
  assessRoverApproachNavigationSegmentInScene,
  buildRoverApproachNavigationScene,
  planRoverApproachNavigationPathInScene,
  toRoverNavigationPlanSummary,
  type RoverApproachRobotFootprint,
  type RoverApproachNavigationScene,
} from "./approachNavigation";
import {
  buildRoverNavigationIntent,
  buildRoverNavigationSceneSummary,
  type RoverNavigationBlockedReason,
  type RoverNavigationPlanSummary,
  type RoverNavigationPlannerStage,
  type RoverNavigationSceneSummary,
} from "./approachNavigationContracts";
import { ROVER_APPROACH_NAVIGATION_CONFIG } from "./approachNavigationParams";
import {
  buildRoverApproachPlanarObstacles,
  type WorldObjectObstacleSource,
} from "./approachObstacleProjection";

export type RoverApproachWorldNavigationContext = {
  obstacles: RoverApproachPlanarObstacle[];
  scene: RoverApproachNavigationScene;
  sceneSummary: RoverNavigationSceneSummary;
};

export type RoverApproachWorldVector3Tuple = Vector3Tuple;

export type RoverApproachWorldNavigationDiagnostics = {
  routeMode: "direct" | "path" | "blocked";
  plannerStage: RoverNavigationPlannerStage;
  blockedReason: RoverNavigationBlockedReason;
  waypointCount: number;
  usedDetourFallback: boolean;
  objectCount: number;
  obstacleCount: number;
  sceneCacheHit: boolean;
  sceneCacheKey: string | null;
  workerUsed: boolean;
  pathClearanceM: number;
  minimumClearanceM: number | null;
  timeoutBonusMs: number;
  contextBuildMs: number;
  routeSolveMs: number;
  totalMs: number;
};

export type SerializedWorldObjectObstacleSource = {
  id: string;
  type: WorldObjectObstacleSource["type"];
  position: RoverApproachWorldVector3Tuple;
  rotation?: RoverApproachWorldVector3Tuple;
  size: RoverApproachWorldVector3Tuple;
  isHidden?: boolean;
};

export type RoverApproachWorldRouteResult =
  | {
      mode: "direct";
      waypointWorlds: THREE.Vector3[];
      pathClearanceM: number;
      minimumClearanceM: number | null;
      timeoutBonusMs: number;
      usedDetourFallback: false;
      plannerSummary: RoverNavigationPlanSummary;
      diagnostics?: RoverApproachWorldNavigationDiagnostics;
    }
  | {
      mode: "path";
      waypointWorlds: THREE.Vector3[];
      pathClearanceM: number;
      minimumClearanceM: number | null;
      timeoutBonusMs: number;
      usedDetourFallback: boolean;
      plannerSummary: RoverNavigationPlanSummary;
      diagnostics?: RoverApproachWorldNavigationDiagnostics;
    }
  | {
      mode: "blocked";
      waypointWorlds: THREE.Vector3[];
      pathClearanceM: number;
      minimumClearanceM: number | null;
      timeoutBonusMs: number;
      usedDetourFallback: false;
      plannerSummary: RoverNavigationPlanSummary;
      diagnostics?: RoverApproachWorldNavigationDiagnostics;
    };

export type SerializedRoverApproachWorldRouteResult =
  | {
      mode: "direct";
      waypointWorlds: RoverApproachWorldVector3Tuple[];
      pathClearanceM: number;
      minimumClearanceM: number | null;
      timeoutBonusMs: number;
      usedDetourFallback: false;
      plannerSummary: RoverNavigationPlanSummary;
      diagnostics?: RoverApproachWorldNavigationDiagnostics;
    }
  | {
      mode: "path";
      waypointWorlds: RoverApproachWorldVector3Tuple[];
      pathClearanceM: number;
      minimumClearanceM: number | null;
      timeoutBonusMs: number;
      usedDetourFallback: boolean;
      plannerSummary: RoverNavigationPlanSummary;
      diagnostics?: RoverApproachWorldNavigationDiagnostics;
    }
  | {
      mode: "blocked";
      waypointWorlds: RoverApproachWorldVector3Tuple[];
      pathClearanceM: number;
      minimumClearanceM: number | null;
      timeoutBonusMs: number;
      usedDetourFallback: false;
      plannerSummary: RoverNavigationPlanSummary;
      diagnostics?: RoverApproachWorldNavigationDiagnostics;
    };

export type RoverApproachWorldRouteRequest = {
  objects: SerializedWorldObjectObstacleSource[];
  upAxisWorld: RoverApproachWorldVector3Tuple;
  segmentStartWorld: RoverApproachWorldVector3Tuple;
  segmentEndWorld: RoverApproachWorldVector3Tuple;
  excludedObstacleId?: string | null;
  excludedObstacleIds?: string[] | null;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  isObjectContactTarget: boolean;
};

const resolveRoverApproachPathClearanceM = ({
  roverBaseRadiusM,
  isObjectContactTarget,
}: {
  roverBaseRadiusM: number;
  isObjectContactTarget: boolean;
}): number =>
  roverBaseRadiusM +
  (isObjectContactTarget
    ? ROVER_APPROACH_DETOUR_CONFIG.objectContactPathClearancePaddingM
    : ROVER_APPROACH_DETOUR_CONFIG.pathClearancePaddingM);

const resolveExcludedObstacleIdSet = ({
  excludedObstacleId,
  excludedObstacleIds,
}: {
  excludedObstacleId?: string | null;
  excludedObstacleIds?: readonly string[] | null;
}): Set<string> => {
  const ids = new Set<string>();
  if (excludedObstacleId) {
    ids.add(excludedObstacleId);
  }
  excludedObstacleIds?.forEach((id) => {
    if (id) {
      ids.add(id);
    }
  });
  return ids;
};

const filterObstaclesByExcludedIds = <T extends { id: string }>({
  obstacles,
  excludedObstacleId,
  excludedObstacleIds,
}: {
  obstacles: readonly T[];
  excludedObstacleId?: string | null;
  excludedObstacleIds?: readonly string[] | null;
}): T[] => {
  const excludedObstacleIdSet = resolveExcludedObstacleIdSet({
    excludedObstacleId,
    excludedObstacleIds,
  });
  return obstacles.filter(
    (obstacle) => !excludedObstacleIdSet.has(obstacle.id),
  );
};

export const countIncludedObstacles = <T extends { id: string }>({
  obstacles,
  excludedObstacleId,
  excludedObstacleIds,
}: {
  obstacles: readonly T[];
  excludedObstacleId?: string | null;
  excludedObstacleIds?: readonly string[] | null;
}): number =>
  filterObstaclesByExcludedIds({
    obstacles,
    excludedObstacleId,
    excludedObstacleIds,
  }).length;

const resolveRoverApproachNavigationTimeoutBonusMs = (
  waypointCount: number,
): number =>
  Math.min(
    ROVER_APPROACH_NAVIGATION_CONFIG.maxTimeoutBonusMs,
    Math.max(0, waypointCount) *
      ROVER_APPROACH_NAVIGATION_CONFIG.timeoutBonusPerWaypointMs,
  );

type BuildRouteResultParams =
  | {
      mode: "direct";
      waypointWorlds: THREE.Vector3[];
      pathClearanceM: number;
      plannerSummary: RoverNavigationPlanSummary;
    }
  | {
      mode: "path";
      waypointWorlds: THREE.Vector3[];
      pathClearanceM: number;
      usedDetourFallback: boolean;
      plannerSummary: RoverNavigationPlanSummary;
    }
  | {
      mode: "blocked";
      waypointWorlds: THREE.Vector3[];
      pathClearanceM: number;
      plannerSummary: RoverNavigationPlanSummary;
    };

type RouteResultBase = {
  waypointWorlds: THREE.Vector3[];
  pathClearanceM: number;
  minimumClearanceM: number | null;
  timeoutBonusMs: number;
  plannerSummary: RoverNavigationPlanSummary;
};

const buildRouteResultBase = ({
  mode,
  waypointWorlds,
  pathClearanceM,
  plannerSummary,
}: BuildRouteResultParams): RouteResultBase => ({
  waypointWorlds,
  pathClearanceM,
  minimumClearanceM: plannerSummary.minimumClearanceM,
  timeoutBonusMs:
    mode === "path"
      ? resolveRoverApproachNavigationTimeoutBonusMs(waypointWorlds.length)
      : 0,
  plannerSummary,
});

const buildRouteResult = (
  params: BuildRouteResultParams,
): RoverApproachWorldRouteResult => {
  const base = buildRouteResultBase(params);
  if (params.mode === "path") {
    return {
      mode: "path",
      ...base,
      usedDetourFallback: params.usedDetourFallback,
    };
  }
  if (params.mode === "direct") {
    return {
      mode: "direct",
      ...base,
      usedDetourFallback: false,
    };
  }
  return {
    mode: "blocked",
    ...base,
    usedDetourFallback: false,
  };
};

const resolveRoverApproachRoutePolylineClear = ({
  segmentStartWorld,
  waypointWorlds,
  segmentEndWorld,
  scene,
  obstacles,
  robotFootprint,
  pathClearanceM,
}: {
  segmentStartWorld: THREE.Vector3;
  waypointWorlds: readonly THREE.Vector3[];
  segmentEndWorld: THREE.Vector3;
  scene: RoverApproachNavigationScene;
  obstacles: RoverApproachPlanarObstacle[];
  robotFootprint?: RoverApproachRobotFootprint;
  pathClearanceM: number;
}): boolean => {
  let previousPointWorld = segmentStartWorld;
  for (const nextPointWorld of [...waypointWorlds, segmentEndWorld]) {
    const assessment = assessRoverApproachNavigationSegmentInScene({
      segmentStartWorld: previousPointWorld,
      segmentEndWorld: nextPointWorld,
      scene,
      obstacles,
      pathClearanceM,
      robotFootprint,
    });
    if (!assessment.isClear) {
      return false;
    }
    previousPointWorld = nextPointWorld;
  }
  return true;
};

const resolveValidatedNavigationDecisionRoute = ({
  mode,
  segmentStartWorld,
  waypointWorlds,
  segmentEndWorld,
  scene,
  obstacles,
  robotFootprint,
  pathClearanceM,
  plannerSummary,
}: {
  mode: "direct" | "path";
  segmentStartWorld: THREE.Vector3;
  waypointWorlds: THREE.Vector3[];
  segmentEndWorld: THREE.Vector3;
  scene: RoverApproachNavigationScene;
  obstacles: RoverApproachPlanarObstacle[];
  robotFootprint?: RoverApproachRobotFootprint;
  pathClearanceM: number;
  plannerSummary: RoverNavigationPlanSummary;
}): RoverApproachWorldRouteResult => {
  if (
    !resolveRoverApproachRoutePolylineClear({
      segmentStartWorld,
      waypointWorlds,
      segmentEndWorld,
      scene,
      obstacles,
      robotFootprint,
      pathClearanceM,
    })
  ) {
    return buildRouteResult({
      mode: "blocked",
      waypointWorlds: [],
      pathClearanceM,
      plannerSummary: {
        ...plannerSummary,
        mode: "blocked",
        plannerStage: "blocked",
        blockedReason: "route-validation-failed",
      },
    });
  }

  if (mode === "direct") {
    return buildRouteResult({
      mode: "direct",
      waypointWorlds,
      pathClearanceM,
      plannerSummary,
    });
  }

  return buildRouteResult({
    mode: "path",
    waypointWorlds,
    pathClearanceM,
    usedDetourFallback: false,
    plannerSummary,
  });
};

export const toRoverApproachWorldVector3Tuple = (
  value: THREE.Vector3,
): RoverApproachWorldVector3Tuple => toVector3Tuple(value);

export const fromRoverApproachWorldVector3Tuple = (
  value: RoverApproachWorldVector3Tuple,
): THREE.Vector3 => new THREE.Vector3(value[0], value[1], value[2]);

export const serializeWorldObjectObstacleSource = (
  object: WorldObjectObstacleSource,
): SerializedWorldObjectObstacleSource => ({
  id: object.id,
  type: object.type,
  position: toRoverApproachWorldVector3Tuple(object.position),
  rotation: object.rotation
    ? [object.rotation.x, object.rotation.y, object.rotation.z]
    : undefined,
  size: toRoverApproachWorldVector3Tuple(object.size),
  isHidden: object.isHidden,
});

export const deserializeWorldObjectObstacleSource = (
  object: SerializedWorldObjectObstacleSource,
): WorldObjectObstacleSource => ({
  id: object.id,
  type: object.type,
  position: fromRoverApproachWorldVector3Tuple(object.position),
  rotation: object.rotation
    ? new THREE.Euler(
        object.rotation[0],
        object.rotation[1],
        object.rotation[2],
        "XYZ",
      )
    : undefined,
  size: fromRoverApproachWorldVector3Tuple(object.size),
  isHidden: object.isHidden,
});

export const serializeRoverApproachWorldRouteResult = (
  result: RoverApproachWorldRouteResult,
): SerializedRoverApproachWorldRouteResult => ({
  ...result,
  waypointWorlds: result.waypointWorlds.map(toRoverApproachWorldVector3Tuple),
});

export const deserializeRoverApproachWorldRouteResult = (
  result: SerializedRoverApproachWorldRouteResult,
): RoverApproachWorldRouteResult => ({
  ...result,
  waypointWorlds: result.waypointWorlds.map(fromRoverApproachWorldVector3Tuple),
});

export const createRoverApproachWorldNavigationSceneCacheKey = ({
  objects,
  upAxisWorld,
}: Pick<RoverApproachWorldRouteRequest, "objects" | "upAxisWorld">): string =>
  hashString(
    JSON.stringify({
      upAxisWorld,
      objects: objects.map((object) => ({
        id: object.id,
        type: object.type,
        position: object.position,
        rotation: object.rotation,
        size: object.size,
        isHidden: object.isHidden === true,
      })),
    }),
  );

export const buildRoverApproachWorldNavigationContext = ({
  objects,
  upAxisWorld,
}: {
  objects: WorldObjectObstacleSource[];
  upAxisWorld: THREE.Vector3;
}): RoverApproachWorldNavigationContext => {
  const obstacles = buildRoverApproachPlanarObstacles({
    objects,
    upAxisWorld,
  });
  return {
    obstacles,
    scene: buildRoverApproachNavigationScene({
      upAxisWorld,
      obstacles,
    }),
    sceneSummary: buildRoverNavigationSceneSummary({
      objects,
      obstacleCount: obstacles.length,
    }),
  };
};

export const resolveRoverApproachWorldRoute = ({
  segmentStartWorld,
  segmentEndWorld,
  upAxisWorld,
  navigationContext,
  excludedObstacleId,
  excludedObstacleIds,
  roverBaseRadiusM,
  robotFootprint,
  isObjectContactTarget,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  upAxisWorld: THREE.Vector3;
  navigationContext: RoverApproachWorldNavigationContext;
  excludedObstacleId?: string | null;
  excludedObstacleIds?: readonly string[] | null;
  roverBaseRadiusM: number;
  robotFootprint?: RoverApproachRobotFootprint;
  isObjectContactTarget: boolean;
}): RoverApproachWorldRouteResult => {
  const navigationIntent = buildRoverNavigationIntent({
    segmentStartWorld,
    segmentEndWorld,
    upAxisWorld,
    roverBaseRadiusM,
    robotFootprint,
    excludedObstacleIds: [
      ...resolveExcludedObstacleIdSet({
        excludedObstacleId,
        excludedObstacleIds,
      }),
    ],
    isObjectContactTarget,
  });
  const obstacles = filterObstaclesByExcludedIds({
    obstacles: navigationContext.obstacles,
    excludedObstacleIds: navigationIntent.excludedObstacleIds,
  });
  const pathClearanceM = resolveRoverApproachPathClearanceM({
    roverBaseRadiusM: navigationIntent.roverBaseRadiusM,
    isObjectContactTarget: navigationIntent.targetKind === "object-contact",
  });
  const scene = navigationContext.scene;
  const navigationDecision = planRoverApproachNavigationPathInScene({
    segmentStartWorld: navigationIntent.segmentStartWorld,
    segmentEndWorld: navigationIntent.segmentEndWorld,
    scene,
    obstacles,
    pathClearanceM,
    robotFootprint: navigationIntent.robotFootprint,
  });
  const plannerSummary = toRoverNavigationPlanSummary(navigationDecision);
  if (navigationDecision.mode === "direct") {
    return resolveValidatedNavigationDecisionRoute({
      mode: "direct",
      segmentStartWorld,
      waypointWorlds: [],
      segmentEndWorld,
      scene,
      obstacles,
      robotFootprint,
      pathClearanceM,
      plannerSummary,
    });
  }
  if (navigationDecision.mode === "path") {
    const waypointWorlds = navigationDecision.waypointWorlds.map((waypoint) =>
      waypoint.clone(),
    );
    return resolveValidatedNavigationDecisionRoute({
      mode: "path",
      segmentStartWorld,
      waypointWorlds,
      segmentEndWorld,
      scene,
      obstacles,
      robotFootprint,
      pathClearanceM,
      plannerSummary,
    });
  }
  if (plannerSummary.blockedReason !== "no-traversable-corridor") {
    return buildRouteResult({
      mode: "blocked",
      waypointWorlds: [],
      pathClearanceM,
      plannerSummary,
    });
  }

  const detourDecision = resolveRoverApproachDetourWaypoint({
    segmentStartWorld,
    segmentEndWorld,
    upAxisWorld,
    obstacles,
    pathClearanceM,
  });
  if (
    detourDecision.mode !== "detour" ||
    detourDecision.waypointWorld === null
  ) {
    return buildRouteResult({
      mode: "blocked",
      waypointWorlds: [],
      pathClearanceM,
      plannerSummary,
    });
  }

  const detourWaypointWorlds = [detourDecision.waypointWorld.clone()];
  return resolveRoverApproachRoutePolylineClear({
    segmentStartWorld,
    waypointWorlds: detourWaypointWorlds,
    segmentEndWorld,
    scene,
    obstacles,
    robotFootprint,
    pathClearanceM,
  })
    ? buildRouteResult({
        mode: "path",
        waypointWorlds: detourWaypointWorlds,
        pathClearanceM,
        usedDetourFallback: true,
        plannerSummary: {
          mode: "path",
          plannerStage: "detour",
          blockedReason: "none",
          minimumClearanceM: plannerSummary.minimumClearanceM,
          waypointCount: detourWaypointWorlds.length,
        },
      })
    : buildRouteResult({
        mode: "blocked",
        waypointWorlds: [],
        pathClearanceM,
        plannerSummary: {
          ...plannerSummary,
          mode: "blocked",
          plannerStage: "blocked",
          blockedReason: "route-validation-failed",
        },
      });
};

export const assessRoverApproachWorldSegmentClearance = ({
  segmentStartWorld,
  segmentEndWorld,
  navigationContext,
  excludedObstacleId,
  excludedObstacleIds,
  robotFootprint,
  pathClearanceM,
  footprintForwardWorldStart,
  footprintForwardWorldEnd,
}: {
  segmentStartWorld: THREE.Vector3;
  segmentEndWorld: THREE.Vector3;
  navigationContext: RoverApproachWorldNavigationContext;
  excludedObstacleId?: string | null;
  excludedObstacleIds?: readonly string[] | null;
  robotFootprint?: RoverApproachRobotFootprint;
  pathClearanceM: number;
  footprintForwardWorldStart?: THREE.Vector3;
  footprintForwardWorldEnd?: THREE.Vector3;
}) =>
  assessRoverApproachNavigationSegmentInScene({
    segmentStartWorld,
    segmentEndWorld,
    scene: navigationContext.scene,
    obstacles: filterObstaclesByExcludedIds({
      obstacles: navigationContext.obstacles,
      excludedObstacleId,
      excludedObstacleIds,
    }),
    pathClearanceM,
    robotFootprint,
    footprintForwardWorldStart,
    footprintForwardWorldEnd,
  });

export const resolveRoverApproachWorldRouteFromRequest = (
  request: RoverApproachWorldRouteRequest,
  navigationContext?: RoverApproachWorldNavigationContext,
): RoverApproachWorldRouteResult => {
  const upAxisWorld = fromRoverApproachWorldVector3Tuple(request.upAxisWorld);
  const context =
    navigationContext ??
    buildRoverApproachWorldNavigationContext({
      objects: request.objects.map(deserializeWorldObjectObstacleSource),
      upAxisWorld,
    });
  return resolveRoverApproachWorldRoute({
    segmentStartWorld: fromRoverApproachWorldVector3Tuple(
      request.segmentStartWorld,
    ),
    segmentEndWorld: fromRoverApproachWorldVector3Tuple(
      request.segmentEndWorld,
    ),
    upAxisWorld,
    navigationContext: context,
    excludedObstacleId: request.excludedObstacleId,
    excludedObstacleIds: request.excludedObstacleIds,
    roverBaseRadiusM: request.roverBaseRadiusM,
    robotFootprint: request.robotFootprint,
    isObjectContactTarget: request.isObjectContactTarget,
  });
};
