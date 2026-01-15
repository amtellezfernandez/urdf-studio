import { create } from "zustand";
import type { IkSolverId, IkSolverMeta } from "./types";
import { isIkfastAvailable } from "./ikfastSolver";
import { LOCAL_SOLVER_DEFS } from "./registry";

type IkSolverStore = {
  selectedSolverId: IkSolverId;
  availableSolvers: IkSolverMeta[];
  setSelectedSolverId: (solverId: IkSolverId) => void;
  setAvailableSolvers: (solvers: IkSolverMeta[]) => void;
};

const buildInitialAvailable = (): IkSolverMeta[] => {
  if (!isIkfastAvailable()) {
    return [];
  }
  return LOCAL_SOLVER_DEFS.filter((solver) => solver.id === "ikfast-wasm");
};

export const useIkSolverStore = create<IkSolverStore>((set) => ({
  selectedSolverId: "pyroki-http",
  availableSolvers: buildInitialAvailable(),
  setSelectedSolverId: (solverId) => set({ selectedSolverId: solverId }),
  setAvailableSolvers: (solvers) => set({ availableSolvers: solvers }),
}));
