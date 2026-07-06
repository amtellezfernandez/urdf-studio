import { createWorkerTaskBroker } from "@/shared/lib/workerTaskRunner";
import { nowMs } from "@/shared/lib/time";
import { recordRoverApproachNavigationDiagnostics } from "./approachWorldNavigationDebug";
import {
  buildRoverApproachWorldNavigationDiagnostics,
  countIncludedObstacles,
  deserializeRoverApproachWorldRouteResult,
  resolveRoverApproachWorldRouteFromRequest,
  serializeRoverApproachWorldRouteResult,
  type RoverApproachWorldRouteRequest,
  type RoverApproachWorldRouteResult,
  type SerializedRoverApproachWorldRouteResult,
} from "./approachWorldNavigation";
import { ROVER_APPROACH_WORLD_NAVIGATION_WORKER_PARAMS } from "./approachWorldNavigationWorkerParams";

type WorkerResponse =
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

const broker = createWorkerTaskBroker<
  RoverApproachWorldRouteRequest,
  WorkerResponse
>(() => {
  if (typeof Worker === "undefined") {
    return null;
  }
  return new Worker(
    new URL("./approachWorldNavigation.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
});

export const resolveRoverApproachWorldRouteAsync = async (
  request: RoverApproachWorldRouteRequest,
  signal?: AbortSignal,
) => {
  if (signal?.aborted) {
    return null;
  }
  const startMs = nowMs();
  const response = await broker.run(request, {
    signal,
    shouldUseWorker: (nextRequest) =>
      nextRequest.objects.length >=
      ROVER_APPROACH_WORLD_NAVIGATION_WORKER_PARAMS.minObjectCountForWorker,
    fallback: (nextRequest) => ({
      id: -1,
      type: "route",
      result: serializeForFallback(nextRequest, startMs),
    }),
    shouldFallback: (result) => result.type !== "route",
  });
  if (signal?.aborted || response === null) {
    return null;
  }
  if (response.type !== "route") {
    const fallbackResult = resolveRoverApproachWorldRouteFromRequest(request);
    const diagnostics = buildFallbackDiagnostics({
      request,
      fallbackResult,
      elapsedMs: nowMs() - startMs,
    });
    const resultWithDiagnostics = {
      ...fallbackResult,
      diagnostics,
    };
    recordRoverApproachNavigationDiagnostics(diagnostics);
    return resultWithDiagnostics;
  }
  const result = deserializeRoverApproachWorldRouteResult(response.result);
  if (result.diagnostics) {
    recordRoverApproachNavigationDiagnostics(result.diagnostics);
  }
  return result;
};

const buildFallbackDiagnostics = ({
  request,
  fallbackResult,
  elapsedMs,
}: {
  request: RoverApproachWorldRouteRequest;
  fallbackResult: RoverApproachWorldRouteResult;
  elapsedMs: number;
}) =>
  buildRoverApproachWorldNavigationDiagnostics({
    result: fallbackResult,
    objectCount: request.objects.length,
    obstacleCount: countIncludedObstacles({
      obstacles: request.objects,
      excludedObstacleId: request.excludedObstacleId,
      excludedObstacleIds: request.excludedObstacleIds,
    }),
    sceneCacheHit: false,
    sceneCacheKey: null,
    workerUsed: false,
    contextBuildMs: 0,
    routeSolveMs: elapsedMs,
    totalMs: elapsedMs,
  });

const serializeForFallback = (
  request: RoverApproachWorldRouteRequest,
  startMs: number,
) => {
  const fallbackResult = resolveRoverApproachWorldRouteFromRequest(request);
  const elapsedMs = nowMs() - startMs;
  return serializeRoverApproachWorldRouteResult({
    ...fallbackResult,
    diagnostics: buildFallbackDiagnostics({
      request,
      fallbackResult,
      elapsedMs,
    }),
  });
};
