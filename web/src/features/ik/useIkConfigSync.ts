import { useEffect } from "react";
import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import type { IkConfigResponse } from "./types";
import { useIkParamsStore } from "./useIkParamsStore";

const mapSolverTuning = (tuning?: IkConfigResponse["solver_tuning"]) => {
  if (!tuning) return {};
  const mapped: Record<string, {
    positionWeight: number;
    orientationWeight: number;
    postureWeight: number;
    velocityDt: number;
    limitWeight: number;
    smoothAlpha: number;
    maxStepDelta: number;
    maxBlendDelta: number;
    solveIterations: number;
  }> = {};
  Object.entries(tuning).forEach(([key, value]) => {
    if (!value) return;
    mapped[key] = {
      positionWeight: value.position_weight ?? 0,
      orientationWeight: value.orientation_weight ?? 0,
      postureWeight: value.posture_weight ?? 0,
      velocityDt: value.velocity_dt ?? 0,
      limitWeight: value.limit_weight ?? 0,
      smoothAlpha: value.smooth_alpha ?? 0,
      maxStepDelta: value.max_step_delta ?? 0,
      maxBlendDelta: value.max_blend_delta ?? 0,
      solveIterations: value.solve_iterations ?? 0,
    };
  });
  return mapped;
};

export const useIkConfigSync = (options?: { enabled?: boolean }) => {
  const setConfig = useIkParamsStore((s) => s.setConfig);
  const enabled = (options?.enabled ?? true) && FEATURE_GATES.ikRemoteSolve.enabled;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const fetchConfig = async () => {
      try {
        const response = await guardedFetch(`${API_BASE_URL}/ik/config`, undefined, {
          requiredBackends: FEATURE_GATES.ikRemoteSolve.requiredBackends,
          context: "IK config sync",
        });
        if (!response.ok) return;
        const data = (await response.json()) as IkConfigResponse;

        if (cancelled) return;

        const nextConfig: Parameters<typeof setConfig>[0] = {};
        nextConfig.configVersion = data.version ?? null;
        if (data.timeouts?.request_ms !== undefined) {
          nextConfig.requestTimeoutMs = data.timeouts.request_ms;
        }
        if (data.timeouts?.drag_ms !== undefined) {
          nextConfig.dragTimeoutMs = data.timeouts.drag_ms;
        }
        if (data.timeouts?.orbit_ms !== undefined) {
          nextConfig.orbitTimeoutMs = data.timeouts.orbit_ms;
        }
        if (data.drag) {
          nextConfig.dragConfig = {
            maxDragSpeed: data.drag.max_drag_speed ?? 0.8,
            minSolveDistance: data.drag.min_solve_distance ?? 0.005,
            springStrength: data.drag.spring_strength ?? 30,
            springDamping: data.drag.spring_damping ?? 18,
            snapDistance: data.drag.snap_distance ?? 0.004,
            reachMargin: data.drag.reach_margin ?? 1.2,
            ikThrottleMs: data.drag.ik_throttle_ms ?? 60,
            maxLinkTraversal: data.drag.max_link_traversal ?? 200,
          };
        }
        if (data.orbit) {
          nextConfig.orbitDefaults = {
            radius: data.orbit.radius ?? 0.3,
            inclinationDeg: data.orbit.inclination_deg ?? 45,
            phaseDeg: data.orbit.phase_deg ?? 0,
            secondaryOffsetDeg: data.orbit.secondary_offset_deg ?? 180,
          };
        }
        nextConfig.solverTuning = mapSolverTuning(data.solver_tuning);
        setConfig(nextConfig);
      } catch {
        // Ignore config sync failures.
      }
    };

    void fetchConfig();
    return () => {
      cancelled = true;
    };
  }, [enabled, setConfig]);
};
