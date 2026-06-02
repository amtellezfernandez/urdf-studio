import { isMetricsEnabled } from "@/shared/lib/metrics";
import type { DisplayMetrics, DisplayStatus } from "@/features/displays/types";
import type { RoverApproachWorldNavigationDiagnostics } from "./approachWorldNavigation";

type RoverApproachNavigationDebugWindow = Window & {
  __roverApproachNavigationDiagnostics?: RoverApproachWorldNavigationDiagnostics[];
  __roverApproachNavigationDiagnosticsLimit?: number;
  __roverApproachNavigationLastDiagnostics?: RoverApproachWorldNavigationDiagnostics;
};

const getDebugWindow = (): RoverApproachNavigationDebugWindow =>
  window as RoverApproachNavigationDebugWindow;

export const recordRoverApproachNavigationDiagnostics = (
  diagnostics: RoverApproachWorldNavigationDiagnostics
) => {
  if (typeof window === "undefined") {
    return;
  }
  const debugWindow = getDebugWindow();
  const list = debugWindow.__roverApproachNavigationDiagnostics ?? [];
  const limit = debugWindow.__roverApproachNavigationDiagnosticsLimit ?? 100;
  debugWindow.__roverApproachNavigationDiagnostics = list;
  debugWindow.__roverApproachNavigationDiagnosticsLimit = limit;
  debugWindow.__roverApproachNavigationLastDiagnostics = diagnostics;
  list.push(diagnostics);
  if (list.length > limit) {
    list.splice(0, list.length - limit);
  }
  if (isMetricsEnabled(window, import.meta.env) && typeof console !== "undefined") {
    console.debug("[metrics] rover:navigation", diagnostics);
  }
};

export const resolveRoverApproachNavigationDisplayStatus = (
  diagnostics: RoverApproachWorldNavigationDiagnostics
): DisplayStatus => {
  if (diagnostics.routeMode === "blocked") {
    return "error";
  }
  if (
    !diagnostics.sceneCacheHit ||
    diagnostics.usedDetourFallback ||
    diagnostics.plannerStage !== "direct"
  ) {
    return "warning";
  }
  return "ok";
};

export const toRoverApproachNavigationDisplayMetrics = (
  diagnostics: RoverApproachWorldNavigationDiagnostics
): DisplayMetrics => ({
  waypoint_count: diagnostics.waypointCount,
  object_count: diagnostics.objectCount,
  obstacle_count: diagnostics.obstacleCount,
  scene_cache_hit: diagnostics.sceneCacheHit ? 1 : 0,
  worker_used: diagnostics.workerUsed ? 1 : 0,
  detour_fallback: diagnostics.usedDetourFallback ? 1 : 0,
  planner_stage_grid: diagnostics.plannerStage === "grid" ? 1 : 0,
  planner_stage_visibility: diagnostics.plannerStage === "visibility" ? 1 : 0,
  planner_stage_detour: diagnostics.plannerStage === "detour" ? 1 : 0,
  path_clearance_milli_m: Math.round(diagnostics.pathClearanceM * 1000),
  min_clearance_milli_m: Math.round((diagnostics.minimumClearanceM ?? 0) * 1000),
  timeout_bonus_ms: Math.round(diagnostics.timeoutBonusMs),
  context_build_ms: Math.round(diagnostics.contextBuildMs),
  route_solve_ms: Math.round(diagnostics.routeSolveMs),
  total_ms: Math.round(diagnostics.totalMs),
});

export const formatRoverApproachNavigationDiagnosticLine = (
  diagnostics: RoverApproachWorldNavigationDiagnostics
): string => {
  const routeModeLabel =
    diagnostics.routeMode === "path"
      ? "PATH"
      : diagnostics.routeMode === "direct"
        ? "DIRECT"
        : "BLOCKED";
  const cacheLabel = diagnostics.sceneCacheHit ? "cache-hit" : "cache-miss";
  const workerLabel = diagnostics.workerUsed ? "worker" : "main";
  const fallbackLabel = diagnostics.usedDetourFallback ? " detour-fallback" : "";
  const blockedReasonLabel =
    diagnostics.blockedReason !== "none" ? ` ${diagnostics.blockedReason}` : "";
  return [
    `NAV ${routeModeLabel}/${diagnostics.plannerStage.toUpperCase()}${blockedReasonLabel}`,
    `${diagnostics.waypointCount} wp`,
    `${workerLabel}`,
    `${cacheLabel}${fallbackLabel}`,
    `solve ${Math.round(diagnostics.routeSolveMs)}ms`,
    `total ${Math.round(diagnostics.totalMs)}ms`,
  ].join(" | ");
};
