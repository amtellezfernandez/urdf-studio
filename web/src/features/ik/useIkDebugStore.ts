import { create } from "zustand";
import type { IkResponsePayload } from "@/features/viewer/ik-types";

type IkDebugStatus = "idle" | "running" | "success" | "error";

type IkDebugState = {
  status: IkDebugStatus;
  error: string | null;
  targetName: string | null;
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
  isFollowingOrbit: false,
  orbitFollowProgress: 0,
  durationMs: null,
  diagnostics: null,
  setState: (next) => set((state) => ({ ...state, ...next })),
}));
