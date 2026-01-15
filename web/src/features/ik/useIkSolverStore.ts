import { create } from "zustand";
import type { IkSolverId } from "./types";
import { isIkfastAvailable } from "./ikfastSolver";

type IkSolverStore = {
  selectedSolverId: IkSolverId;
  availableSolverIds: IkSolverId[];
  setSelectedSolverId: (solverId: IkSolverId) => void;
  setAvailableSolverIds: (solverIds: IkSolverId[]) => void;
};

const buildInitialAvailable = (): IkSolverId[] => {
  const base: IkSolverId[] = ["pyroki-http"];
  if (isIkfastAvailable()) {
    base.push("ikfast-wasm");
  }
  return base;
};

export const useIkSolverStore = create<IkSolverStore>((set) => ({
  selectedSolverId: "pyroki-http",
  availableSolverIds: buildInitialAvailable(),
  setSelectedSolverId: (solverId) => set({ selectedSolverId: solverId }),
  setAvailableSolverIds: (solverIds) => set({ availableSolverIds: solverIds }),
}));
