import { create } from "zustand";
import type { OrientationMode } from "@/features/ik/registry";
import { IK_DRAG_CONFIG, IK_ORBIT_DEFAULTS, IK_SOLVER_DEFAULTS } from "@/features/viewer/config";

export type IkOrientationSetting = "auto" | OrientationMode;

type IkParamsState = {
  clickOrientation: IkOrientationSetting;
  dragOrientation: IkOrientationSetting;
  requestTimeoutMs: number;
  dragTimeoutMs: number;
  orbitTimeoutMs: number;
  dragConfig: typeof IK_DRAG_CONFIG;
  orbitDefaults: typeof IK_ORBIT_DEFAULTS;
  solverTuning: Record<string, {
    positionWeight: number;
    orientationWeight: number;
    postureWeight: number;
    velocityDt: number;
    limitWeight: number;
  }>;
  configVersion: string | null;
  setClickOrientation: (mode: IkOrientationSetting) => void;
  setDragOrientation: (mode: IkOrientationSetting) => void;
  setRequestTimeoutMs: (value: number) => void;
  setDragTimeoutMs: (value: number) => void;
  setOrbitTimeoutMs: (value: number) => void;
  setConfig: (next: Partial<Pick<
    IkParamsState,
    "requestTimeoutMs" | "dragTimeoutMs" | "orbitTimeoutMs" | "dragConfig" | "orbitDefaults" | "solverTuning" | "configVersion"
  >>) => void;
};

export const useIkParamsStore = create<IkParamsState>((set) => ({
  clickOrientation: "auto",
  dragOrientation: "auto",
  requestTimeoutMs: IK_SOLVER_DEFAULTS.requestTimeoutMs,
  dragTimeoutMs: IK_SOLVER_DEFAULTS.dragTimeoutMs,
  orbitTimeoutMs: IK_SOLVER_DEFAULTS.orbitTimeoutMs,
  dragConfig: { ...IK_DRAG_CONFIG },
  orbitDefaults: { ...IK_ORBIT_DEFAULTS },
  solverTuning: {},
  configVersion: null,
  setClickOrientation: (mode) => set({ clickOrientation: mode }),
  setDragOrientation: (mode) => set({ dragOrientation: mode }),
  setRequestTimeoutMs: (value) => set({ requestTimeoutMs: value }),
  setDragTimeoutMs: (value) => set({ dragTimeoutMs: value }),
  setOrbitTimeoutMs: (value) => set({ orbitTimeoutMs: value }),
  setConfig: (next) => set((state) => ({ ...state, ...next })),
}));
