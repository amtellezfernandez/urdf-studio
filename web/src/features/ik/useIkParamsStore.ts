import { create } from "zustand";
import type { OrientationMode } from "@/features/ik/registry";
import { IK_SOLVER_DEFAULTS } from "@/features/viewer/config";

export type IkOrientationSetting = "auto" | OrientationMode;

type IkParamsState = {
  clickOrientation: IkOrientationSetting;
  dragOrientation: IkOrientationSetting;
  requestTimeoutMs: number;
  dragTimeoutMs: number;
  orbitTimeoutMs: number;
  setClickOrientation: (mode: IkOrientationSetting) => void;
  setDragOrientation: (mode: IkOrientationSetting) => void;
  setRequestTimeoutMs: (value: number) => void;
  setDragTimeoutMs: (value: number) => void;
  setOrbitTimeoutMs: (value: number) => void;
};

export const useIkParamsStore = create<IkParamsState>((set) => ({
  clickOrientation: "auto",
  dragOrientation: "auto",
  requestTimeoutMs: IK_SOLVER_DEFAULTS.requestTimeoutMs,
  dragTimeoutMs: IK_SOLVER_DEFAULTS.dragTimeoutMs,
  orbitTimeoutMs: IK_SOLVER_DEFAULTS.orbitTimeoutMs,
  setClickOrientation: (mode) => set({ clickOrientation: mode }),
  setDragOrientation: (mode) => set({ dragOrientation: mode }),
  setRequestTimeoutMs: (value) => set({ requestTimeoutMs: value }),
  setDragTimeoutMs: (value) => set({ dragTimeoutMs: value }),
  setOrbitTimeoutMs: (value) => set({ orbitTimeoutMs: value }),
}));
