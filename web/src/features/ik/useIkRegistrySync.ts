import { useEffect } from "react";
import { API_BASE_URL } from "@/shared/config/api";
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

export const useIkRegistrySync = () => {
  const setAvailableSolvers = useIkSolverStore((s) => s.setAvailableSolvers);

  useEffect(() => {
    let cancelled = false;

    const fetchSolvers = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/ik/solvers`);
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
        const serverSolvers: IkSolverMeta[] =
          data?.solvers
            ?.map((solver) => {
              if (!solver?.id) return null;
              return {
                id: solver.id as IkSolverMeta["id"],
                label: solver.label ?? solver.id,
                description: solver.description,
                mode: solver.mode,
                capabilities: solver.capabilities ?? [],
                requirements: solver.requirements ?? [],
                source: "server" as const,
              };
            })
            .filter((entry): entry is IkSolverMeta => !!entry) ?? [];

        const localSolvers = isIkfastAvailable() ? LOCAL_SOLVER_DEFS : [];
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
  }, [setAvailableSolvers]);
};
