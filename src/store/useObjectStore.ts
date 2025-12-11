import { create } from "zustand";
import * as THREE from "three";

export interface CreatedObject {
  id: string;
  type: "cube" | "point";
  position: THREE.Vector3;
  size: THREE.Vector3;
  color: string;
  trackedJointName: string | null;
  isIkTarget: boolean;
  ikTargetType?: "punctual" | "orbit";
  orbitRadius?: number;
  orbitInclination?: number; // in degrees
  orbitPhase?: number; // current position on orbit (0-360 degrees)
  orbitSecondaryOffset?: number; // degrees offset between orbit markers
  orbitTargetPoint?: "center" | "primary" | "secondary"; // which point to use for IK
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
  updateOrbitParams: (id: string, params: { radius?: number; inclination?: number; phase?: number; secondaryOffset?: number }) => void;
  updateOrbitTargetPoint: (id: string, targetPoint: "center" | "primary" | "secondary") => void;
  setSelectedObject: (id: string | null) => void;
  clearObjects: () => void;
}

const POINT_SIZE = 0.02;
let objectIdCounter = 0;

export const useObjectStore = create<ObjectStore>((set, get) => ({
  objects: [],
  selectedObjectId: null,

  addObject: (object) => {
    const id = `object-${objectIdCounter++}`;
    const resolvedSize =
      object.type === "point"
        ? new THREE.Vector3(POINT_SIZE, POINT_SIZE, POINT_SIZE)
        : object.size.clone();
    const newObject: CreatedObject = {
      ...object,
      id,
      position: object.position.clone(),
      size: resolvedSize,
      isIkTarget: object.isIkTarget ?? false,
      ikTargetType: object.ikTargetType ?? "punctual",
      orbitRadius: object.orbitRadius ?? 0.3,
      orbitInclination: object.orbitInclination ?? 45,
      orbitPhase: object.orbitPhase ?? 0,
      orbitSecondaryOffset: object.orbitSecondaryOffset ?? 180,
      orbitTargetPoint: object.orbitTargetPoint ?? "primary",
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
      objects: state.objects.map((obj) => {
        if (obj.id !== id) return obj;
        if (obj.type === "point") return obj; // Points keep a fixed size
        return { ...obj, size: size.clone() };
      }),
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
          orbitSecondaryOffset: params.secondaryOffset !== undefined ? params.secondaryOffset : obj.orbitSecondaryOffset,
        };
      }),
    }));
  },

  updateOrbitTargetPoint: (id, targetPoint) => {
    set((state) => ({
      objects: state.objects.map((obj) =>
        obj.id === id ? { ...obj, orbitTargetPoint: targetPoint } : obj
      ),
    }));
  },

  setSelectedObject: (id) => {
    set({ selectedObjectId: id });
  },

  clearObjects: () => {
    set({ objects: [], selectedObjectId: null });
  },
}));
