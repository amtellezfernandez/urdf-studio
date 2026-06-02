import { describe, expect, it } from "vitest";

import {
  formatRoverApproachNavigationDiagnosticLine,
  resolveRoverApproachNavigationDisplayStatus,
  toRoverApproachNavigationDisplayMetrics,
} from "./approachWorldNavigationDebug";

const BASE_DIAGNOSTICS = {
  routeMode: "path" as const,
  plannerStage: "visibility" as const,
  blockedReason: "none" as const,
  waypointCount: 2,
  usedDetourFallback: false,
  objectCount: 12,
  obstacleCount: 11,
  sceneCacheHit: true,
  sceneCacheKey: "scene-cache-key",
  workerUsed: true,
  pathClearanceM: 0.24,
  minimumClearanceM: 0.31,
  timeoutBonusMs: 2500,
  contextBuildMs: 3.4,
  routeSolveMs: 5.6,
  totalMs: 9.4,
};

describe("approachWorldNavigationDebug", () => {
  it("marks blocked routes as error status", () => {
    expect(
      resolveRoverApproachNavigationDisplayStatus({
        ...BASE_DIAGNOSTICS,
        routeMode: "blocked",
      })
    ).toBe("error");
  });

  it("marks cache misses or detour fallback as warning status", () => {
    expect(
      resolveRoverApproachNavigationDisplayStatus({
        ...BASE_DIAGNOSTICS,
        sceneCacheHit: false,
      })
    ).toBe("warning");
    expect(
      resolveRoverApproachNavigationDisplayStatus({
        ...BASE_DIAGNOSTICS,
        usedDetourFallback: true,
      })
    ).toBe("warning");
  });

  it("maps diagnostics into rounded display metrics", () => {
    expect(toRoverApproachNavigationDisplayMetrics(BASE_DIAGNOSTICS)).toEqual({
      waypoint_count: 2,
      object_count: 12,
      obstacle_count: 11,
      scene_cache_hit: 1,
      worker_used: 1,
      detour_fallback: 0,
      planner_stage_grid: 0,
      planner_stage_visibility: 1,
      planner_stage_detour: 0,
      path_clearance_milli_m: 240,
      min_clearance_milli_m: 310,
      timeout_bonus_ms: 2500,
      context_build_ms: 3,
      route_solve_ms: 6,
      total_ms: 9,
    });
  });

  it("formats a concise navigation diagnostic line", () => {
    expect(formatRoverApproachNavigationDiagnosticLine(BASE_DIAGNOSTICS)).toBe(
      "NAV PATH/VISIBILITY | 2 wp | worker | cache-hit | solve 6ms | total 9ms"
    );
    expect(
      formatRoverApproachNavigationDiagnosticLine({
        ...BASE_DIAGNOSTICS,
        routeMode: "blocked",
        plannerStage: "blocked",
        blockedReason: "no-traversable-corridor",
        waypointCount: 0,
        workerUsed: false,
        sceneCacheHit: false,
        usedDetourFallback: true,
      })
    ).toBe(
      "NAV BLOCKED/BLOCKED no-traversable-corridor | 0 wp | main | cache-miss detour-fallback | solve 6ms | total 9ms"
    );
  });
});
