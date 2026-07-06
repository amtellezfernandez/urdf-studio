/// <reference lib="webworker" />

import { createLruCache } from "@/shared/lib/cache";
import { readUnknownErrorMessage } from "@/shared/lib/errorMessages";
import { nowMs } from "@/shared/lib/time";
import {
  buildRoverApproachWorldNavigationContext,
  countIncludedObstacles,
  createRoverApproachWorldNavigationSceneCacheKey,
  deserializeWorldObjectObstacleSource,
  resolveRoverApproachWorldRouteFromRequest,
  serializeRoverApproachWorldRouteResult,
  fromRoverApproachWorldVector3Tuple,
  type RoverApproachWorldNavigationContext,
  type RoverApproachWorldRouteRequest,
  type SerializedRoverApproachWorldRouteResult,
} from "./approachWorldNavigation";
import { ROVER_APPROACH_WORLD_NAVIGATION_WORKER_PARAMS } from "./approachWorldNavigationWorkerParams";

type ApproachWorldNavigationWorkerRequest = { id: number } & RoverApproachWorldRouteRequest;

type ApproachWorldNavigationWorkerResponse =
  | {
      id: number;
      type: "route";
      result: SerializedRoverApproachWorldRouteResult;
    }
  | {
      id: number;
      type: "error";
      error: string;
    };

const contextCache = createLruCache<RoverApproachWorldNavigationContext>(
  ROVER_APPROACH_WORLD_NAVIGATION_WORKER_PARAMS.sceneCacheLimit
);
const workerScope = self as unknown as DedicatedWorkerGlobalScope;

const getNavigationContext = (
  request: RoverApproachWorldRouteRequest
): { context: RoverApproachWorldNavigationContext; cacheHit: boolean; cacheKey: string } => {
  const cacheKey = createRoverApproachWorldNavigationSceneCacheKey(request);
  const cached = contextCache.get(cacheKey);
  if (cached) {
    return { context: cached, cacheHit: true, cacheKey };
  }
  const context = buildRoverApproachWorldNavigationContext({
    objects: request.objects.map(deserializeWorldObjectObstacleSource),
    upAxisWorld: fromRoverApproachWorldVector3Tuple(request.upAxisWorld),
  });
  contextCache.set(cacheKey, context);
  return { context, cacheHit: false, cacheKey };
};

workerScope.onmessage = (event: MessageEvent<ApproachWorldNavigationWorkerRequest>) => {
  const requestStartMs = nowMs();
  const { id, ...request } = event.data;
  try {
    const contextStartMs = nowMs();
    const { context, cacheHit, cacheKey } = getNavigationContext(request);
    const contextBuildMs = nowMs() - contextStartMs;
    const solveStartMs = nowMs();
    const result = resolveRoverApproachWorldRouteFromRequest(request, context);
    const routeSolveMs = nowMs() - solveStartMs;
    const obstacleCount = countIncludedObstacles({
      obstacles: context.obstacles,
      excludedObstacleId: request.excludedObstacleId,
      excludedObstacleIds: request.excludedObstacleIds,
    });
    const response: ApproachWorldNavigationWorkerResponse = {
      id,
      type: "route",
      result: serializeRoverApproachWorldRouteResult({
        ...result,
        diagnostics: {
          routeMode: result.mode,
          plannerStage: result.plannerSummary.plannerStage,
          blockedReason: result.plannerSummary.blockedReason,
          waypointCount: result.waypointWorlds.length,
          usedDetourFallback: result.usedDetourFallback,
          objectCount: context.sceneSummary.sourceObjectCount,
          obstacleCount,
          sceneCacheHit: cacheHit,
          sceneCacheKey: cacheKey,
          workerUsed: true,
          pathClearanceM: result.pathClearanceM,
          minimumClearanceM: result.minimumClearanceM,
          timeoutBonusMs: result.timeoutBonusMs,
          contextBuildMs,
          routeSolveMs,
          totalMs: nowMs() - requestStartMs,
        },
      }),
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: ApproachWorldNavigationWorkerResponse = {
      id,
      type: "error",
      error: readUnknownErrorMessage(error, "World navigation worker failed"),
    };
    workerScope.postMessage(response);
  }
};
