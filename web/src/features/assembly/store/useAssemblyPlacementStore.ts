import { create } from "zustand";
import { buildAssemblyContactPairKey } from "@/features/assembly/store/assemblyContactPair";

export type AssemblyPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

type AssemblyPlacementState = {
  poses: Record<string, AssemblyPose>;
  radii: Record<string, number>;
  selectedRobotId: string | null;
  contactPairs: string[];
  setPose: (robotId: string, pose: AssemblyPose) => void;
  setPoses: (poses: Record<string, AssemblyPose>) => void;
  setRadius: (robotId: string, radius: number) => void;
  setRadii: (radii: Record<string, number>) => void;
  setSelectedRobotId: (robotId: string | null) => void;
  setContactPairs: (pairs: string[]) => void;
  clear: () => void;
};

export const buildContactPairKey = buildAssemblyContactPairKey;

export const useAssemblyPlacementStore = create<AssemblyPlacementState>((set) => ({
  poses: {},
  radii: {},
  selectedRobotId: null,
  contactPairs: [],
  setPose: (robotId, pose) =>
    set((state) => ({
      poses: { ...state.poses, [robotId]: pose },
    })),
  setPoses: (poses) => set({ poses: { ...poses } }),
  setRadius: (robotId, radius) =>
    set((state) => ({
      radii: { ...state.radii, [robotId]: radius },
    })),
  setRadii: (radii) => set({ radii: { ...radii } }),
  setSelectedRobotId: (robotId) => set({ selectedRobotId: robotId }),
  setContactPairs: (pairs) => set({ contactPairs: [...pairs] }),
  clear: () =>
    set({
      poses: {},
      radii: {},
      selectedRobotId: null,
      contactPairs: [],
    }),
}));
