import { useEffect } from "react";
import { API_BASE_URL } from "@/shared/config/api";
import { guardedFetch } from "@/shared/lib/backendGuard";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import type { IkSolverMeta } from "./types";
import { useIkSolverStore } from "./useIkSolverStore";
import { LOCAL_SOLVER_DEFS } from "./registry";
import { isIkfastAvailable } from "./ikfastSolver";

const mergeSolvers = (server: IkSolverMeta[], local: IkSolverMeta[]) => {
  const merged = new Map<string, IkSolverMeta>();
  server.forEach((solver) => merged.set(solver.id, { ...solver, source: "server" }));
  local.forEach((solver) => {
    if (!merged.has(solver.id)) {
      merged.set(solver.id, { ...solver, source: "local" });
    }
  });
  return Array.from(merged.values());
};

export const useIkRegistrySync = (options?: { enabled?: boolean }) => {
  const setAvailableSolvers = useIkSolverStore((s) => s.setAvailableSolvers);
  const enabled = (options?.enabled ?? true) && FEATURE_GATES.ikRemoteSolve.enabled;

  useEffect(() => {
    if (!enabled) {
      const localSolvers = LOCAL_SOLVER_DEFS.filter(
        (solver) => solver.id !== "ikfast-wasm" || isIkfastAvailable()
      );
      setAvailableSolvers(localSolvers);
      return;
    }

    let cancelled = false;

    const fetchSolvers = async () => {
      try {
        const response = await guardedFetch(`${API_BASE_URL}/ik/solvers`, undefined, {
          requiredBackends: FEATURE_GATES.ikRemoteSolve.requiredBackends,
          context: "IK solver sync",
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          solvers?: Array<{
            id?: string;
            label?: string;
            description?: string;
            mode?: string;
            capabilities?: string[];
            requirements?: string[];
          }>;
        };
        const serverSolvers: IkSolverMeta[] = (data?.solvers ?? []).flatMap((solver) => {
          if (!solver?.id) return [];
          return [
            {
              id: solver.id as IkSolverMeta["id"],
              label: solver.label ?? solver.id,
              description: solver.description,
              mode: solver.mode,
              capabilities: solver.capabilities ?? [],
              requirements: solver.requirements ?? [],
              source: "server" as const,
            },
          ];
        });

        const localSolvers = LOCAL_SOLVER_DEFS.filter(
          (solver) => solver.id !== "ikfast-wasm" || isIkfastAvailable()
        );
        const merged = mergeSolvers(serverSolvers, localSolvers);
        if (!cancelled) {
          setAvailableSolvers(merged);
        }
      } catch {
        // Ignore solver autodetect failures.
      }
    };

    void fetchSolvers();
    return () => {
      cancelled = true;
    };
  }, [enabled, setAvailableSolvers]);
};
