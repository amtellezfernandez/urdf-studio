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

  setSelectedObject: (id) => {
    set({ selectedObjectId: id });
  },

  clearObjects: () => {
    set({ objects: [], selectedObjectId: null });
  },
}));
