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
  roverApproachStatus:
    | "idle"
    | "running"
    | "completed"
    | "skipped"
    | "timeout"
    | "cancelled"
    | "failed";
  roverApproachPhase: "idle" | "rotate" | "translate" | "done";
  roverApproachReason: string | null;
  roverApproachDistanceM: number | null;
  roverApproachYawErrorDeg: number | null;
  roverApproachDurationMs: number | null;
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
  roverApproachStatus: "idle",
  roverApproachPhase: "idle",
  roverApproachReason: null,
  roverApproachDistanceM: null,
  roverApproachYawErrorDeg: null,
  roverApproachDurationMs: null,
  setState: (next) => set((state) => ({ ...state, ...next })),
}));
