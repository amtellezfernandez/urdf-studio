import { create } from "zustand";
import type { IkSolverId, IkSolverMeta } from "./types";
import { LOCAL_SOLVER_DEFS } from "./registry";

type IkSolverStore = {
  selectedSolverId: IkSolverId;
  availableSolvers: IkSolverMeta[];
  setSelectedSolverId: (solverId: IkSolverId) => void;
  setAvailableSolvers: (solvers: IkSolverMeta[]) => void;
};

const JS_SOLVER_ID: IkSolverId = "ik-js";
const JS_SOLVER_META: IkSolverMeta =
  LOCAL_SOLVER_DEFS.find((solver) => solver.id === JS_SOLVER_ID) ??
  ({
    id: JS_SOLVER_ID,
    label: "IK JS (CCD)",
    description: "Local CCD solver (no backend).",
    capabilities: ["Local", "Drag"],
    requirements: [],
    source: "local",
  } satisfies IkSolverMeta);

const buildInitialAvailable = (): IkSolverMeta[] => [JS_SOLVER_META];

export const useIkSolverStore = create<IkSolverStore>((set) => ({
  selectedSolverId: JS_SOLVER_ID,
  availableSolvers: buildInitialAvailable(),
  setSelectedSolverId: () => set({ selectedSolverId: JS_SOLVER_ID }),
  setAvailableSolvers: (solvers) =>
    set(() => {
      const localJs = solvers.find((solver) => solver.id === JS_SOLVER_ID) ?? JS_SOLVER_META;
      return {
        availableSolvers: [{ ...JS_SOLVER_META, ...localJs, id: JS_SOLVER_ID }],
        selectedSolverId: JS_SOLVER_ID,
      };
    }),
}));
