import * as THREE from "three";
import { create } from "zustand";

export type SolidWorldBounds = {
  id: string;
  bounds: THREE.Box3;
};

type WorldCollisionBoundsStore = {
  boundsById: Record<string, THREE.Box3>;
  setBounds: (id: string, bounds: THREE.Box3 | null) => void;
  clearBounds: () => void;
};

export const useWorldCollisionBoundsStore = create<WorldCollisionBoundsStore>((set) => ({
  boundsById: {},
  setBounds: (id, bounds) =>
    set((state) => {
      const next = { ...state.boundsById };
      if (bounds?.isEmpty() === false) {
        next[id] = bounds.clone();
      } else {
        delete next[id];
      }
      return { boundsById: next };
    }),
  clearBounds: () => set({ boundsById: {} }),
}));

export const solidBoundsFromRecord = (
  boundsById: Readonly<Record<string, THREE.Box3>>
): SolidWorldBounds[] =>
  Object.entries(boundsById).map(([id, bounds]) => ({
    id,
    bounds: bounds.clone(),
  }));
