import { create } from "zustand";
import type { IkResponsePayload } from "@/features/viewer/ik-types";

type IkDebugStatus = "idle" | "running" | "success" | "error";

type IkDebugState = {
  status: IkDebugStatus;
  error: string | null;
  targetName: string | null;
  lastTargetPosition: [number, number, number] | null;
  lastTargetQuaternion: [number, number, number, number] | null;
  isFollowingOrbit: boolean;
  orbitFollowProgress: number;
  durationMs: number | null;
  diagnostics: IkResponsePayload["diagnostics"] | null;
  setState: (next: Partial<Omit<IkDebugState, "setState">>) => void;
};

export const useIkDebugStore = create<IkDebugState>((set) => ({
  status: "idle",
  error: null,
  targetName: null,
  lastTargetPosition: null,
  lastTargetQuaternion: null,
  isFollowingOrbit: false,
  orbitFollowProgress: 0,
  durationMs: null,
  diagnostics: null,
  setState: (next) => set((state) => ({ ...state, ...next })),
}));
