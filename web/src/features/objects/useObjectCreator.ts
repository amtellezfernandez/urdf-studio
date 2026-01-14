import { create } from "zustand";
import * as THREE from "three";

export type ObjectCreatorType = "cube" | "point";

interface ObjectCreatorState {
  isOpen: boolean;
  type: ObjectCreatorType;
  robotBoundingBox: THREE.Box3 | null;
  open: (type?: ObjectCreatorType) => void;
  close: () => void;
  setType: (type: ObjectCreatorType) => void;
  setRobotBoundingBox: (box: THREE.Box3 | null) => void;
}

export const useObjectCreatorStore = create<ObjectCreatorState>((set) => ({
  isOpen: false,
  type: "cube",
  robotBoundingBox: null,
  open: (type) =>
    set((state) => ({
      isOpen: true,
      type: type ?? state.type,
    })),
  close: () => set({ isOpen: false }),
  setType: (type) => set({ type }),
  setRobotBoundingBox: (box) =>
    set({ robotBoundingBox: box ? box.clone() : null }),
}));

