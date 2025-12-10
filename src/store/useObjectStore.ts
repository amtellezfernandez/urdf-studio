import { create } from "zustand";
import * as THREE from "three";

export interface CreatedObject {
  id: string;
  type: "cube";
  position: THREE.Vector3;
  size: THREE.Vector3;
  color: string;
  trackedJointName: string | null;
  isIkTarget: boolean;
  ikTargetType?: "punctual" | "orbit";
  orbitRadius?: number;
  orbitInclination?: number; // in degrees
  orbitPhase?: number; // current position on orbit (0-360 degrees)
}

interface ObjectStore {
  objects: CreatedObject[];
  selectedObjectId: string | null;
  addObject: (object: Omit<CreatedObject, "id">) => string;
  removeObject: (id: string) => void;
  updateObjectPosition: (id: string, position: THREE.Vector3) => void;
  updateObjectSize: (id: string, size: THREE.Vector3) => void;
  updateTrackedJoint: (id: string, jointName: string | null) => void;
  updateObjectIkTarget: (id: string, isIkTarget: boolean) => void;
  updateIkTargetType: (id: string, ikTargetType: "punctual" | "orbit") => void;
  updateOrbitParams: (id: string, params: { radius?: number; inclination?: number; phase?: number }) => void;
  setSelectedObject: (id: string | null) => void;
  clearObjects: () => void;
}

let objectIdCounter = 0;

export const useObjectStore = create<ObjectStore>((set, get) => ({
  objects: [],
  selectedObjectId: null,

  addObject: (object) => {
    const id = `object-${objectIdCounter++}`;
    const newObject: CreatedObject = {
      ...object,
      id,
      position: object.position.clone(),
      size: object.size.clone(),
      isIkTarget: object.isIkTarget ?? false,
      ikTargetType: object.ikTargetType ?? "punctual",
      orbitRadius: object.orbitRadius ?? 0.3,
      orbitInclination: object.orbitInclination ?? 45,
      orbitPhase: object.orbitPhase ?? 0,
    };

    set((state) => ({
      objects: [...state.objects, newObject],
      selectedObjectId: id,
    }));

    return id;
  },

  removeObject: (id) => {
    set((state) => ({
      objects: state.objects.filter((obj) => obj.id !== id),
      selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
    }));
  },

  updateObjectPosition: (id, position) => {
    set((state) => ({
      objects: state.objects.map((obj) =>
        obj.id === id ? { ...obj, position: position.clone() } : obj
      ),
    }));
  },

  updateObjectSize: (id, size) => {
    set((state) => ({
      objects: state.objects.map((obj) =>
        obj.id === id ? { ...obj, size: size.clone() } : obj
      ),
    }));
  },

  updateTrackedJoint: (id, jointName) => {
    set((state) => ({
      objects: state.objects.map((obj) =>
        obj.id === id ? { ...obj, trackedJointName: jointName } : obj
      ),
    }));
  },

  updateObjectIkTarget: (id, isIkTarget) => {
    set((state) => ({
      objects: state.objects.map((obj) =>
        obj.id === id ? { ...obj, isIkTarget } : obj
      ),
    }));
  },

  updateIkTargetType: (id, ikTargetType) => {
    set((state) => ({
      objects: state.objects.map((obj) =>
        obj.id === id ? { ...obj, ikTargetType } : obj
      ),
    }));
  },

  updateOrbitParams: (id, params) => {
    set((state) => ({
      objects: state.objects.map((obj) => {
        if (obj.id !== id) return obj;
        return {
          ...obj,
          orbitRadius: params.radius !== undefined ? params.radius : obj.orbitRadius,
          orbitInclination: params.inclination !== undefined ? params.inclination : obj.orbitInclination,
          orbitPhase: params.phase !== undefined ? params.phase : obj.orbitPhase,
        };
      }),
    }));
  },

  setSelectedObject: (id) => {
    set({ selectedObjectId: id });
  },

  clearObjects: () => {
    set({ objects: [], selectedObjectId: null });
  },
}));
