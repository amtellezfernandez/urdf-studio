import { create } from "zustand";
import * as THREE from "three";
import {
  normalizeWorldObjectPositionVector,
  normalizeWorldObjectRotationEuler,
  normalizeWorldObjectSizeVector,
  type WorldObjectPrimitiveType,
} from "./worldObjectGeometry";
import { WORLD_OBJECT_STORE_PARAMS } from "./worldObjectStoreParams";

export interface CreatedObject {
  id: string;
  label?: string;
  type: WorldObjectPrimitiveType;
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  size: THREE.Vector3;
  color: string;
  isHidden?: boolean;
  source?:
    | "user"
    | "world-scenario"
    | "demo-world"
    | "runtime-detection"
    | "runtime-demo"
    | "runtime-restricted-area"
    | "runtime-trajectory";
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
  editMode: "move" | "resize" | "rotate";
  transformSpace: "world" | "local";
  canUndo: boolean;
  canRedo: boolean;
  addObject: (
    object: Omit<CreatedObject, "id">,
    options?: { trackHistory?: boolean; select?: boolean }
  ) => string;
  duplicateObject: (id: string, options?: { trackHistory?: boolean }) => string | null;
  removeObject: (id: string, options?: { trackHistory?: boolean }) => void;
  updateObjectPosition: (
    id: string,
    position: THREE.Vector3,
    options?: { trackHistory?: boolean }
  ) => void;
  updateObjectRotation: (
    id: string,
    rotation: THREE.Euler,
    options?: { trackHistory?: boolean }
  ) => void;
  updateObjectSize: (
    id: string,
    size: THREE.Vector3,
    options?: { trackHistory?: boolean }
  ) => void;
  setObjectHidden: (id: string, isHidden: boolean) => void;
  updateTrackedJoint: (id: string, jointName: string | null) => void;
  updateIkTargetType: (id: string, ikTargetType: "punctual" | "orbit") => void;
  updateOrbitParams: (id: string, params: { radius?: number; inclination?: number; phase?: number; secondaryOffset?: number }) => void;
  updateOrbitTargetPoint: (id: string, targetPoint: "center" | "primary" | "secondary") => void;
  setSelectedObject: (id: string | null) => void;
  setEditMode: (mode: "move" | "resize" | "rotate") => void;
  setTransformSpace: (space: "world" | "local") => void;
  clearObjects: () => void;
  replaceObjectsBySource: (
    source: NonNullable<CreatedObject["source"]>,
    objects: Omit<CreatedObject, "id">[]
  ) => void;
  undo: () => void;
  redo: () => void;
  beginEditSession: () => void;
  endEditSession: () => void;
  cancelEditSession: () => void;
}

let objectIdCounter = 0;

type ObjectSnapshot = {
  objects: CreatedObject[];
  selectedObjectId: string | null;
};

type ObjectStoreInternalState = {
  undoStack: ObjectSnapshot[];
  redoStack: ObjectSnapshot[];
  activeEditSnapshot: ObjectSnapshot | null;
};

const cloneCreatedObject = (object: CreatedObject): CreatedObject => ({
  ...object,
  position: object.position.clone(),
  rotation: normalizeWorldObjectRotationEuler(object.rotation),
  size: object.size.clone(),
});

const cloneSnapshot = (snapshot: ObjectSnapshot): ObjectSnapshot => ({
  objects: snapshot.objects.map(cloneCreatedObject),
  selectedObjectId: snapshot.selectedObjectId,
});

const captureSnapshot = (state: Pick<ObjectStore, "objects" | "selectedObjectId">): ObjectSnapshot =>
  cloneSnapshot({
    objects: state.objects,
    selectedObjectId: state.selectedObjectId,
  });

const snapshotsEqual = (left: ObjectSnapshot, right: ObjectSnapshot): boolean => {
  if (left.selectedObjectId !== right.selectedObjectId) {
    return false;
  }
  if (left.objects.length !== right.objects.length) {
    return false;
  }
  return left.objects.every((leftObject, index) => {
    const rightObject = right.objects[index];
    if (!rightObject) {
      return false;
    }
    return (
      leftObject.id === rightObject.id &&
      leftObject.label === rightObject.label &&
      leftObject.type === rightObject.type &&
      leftObject.color === rightObject.color &&
      leftObject.isHidden === rightObject.isHidden &&
      leftObject.source === rightObject.source &&
      leftObject.trackedJointName === rightObject.trackedJointName &&
      leftObject.isIkTarget === rightObject.isIkTarget &&
      leftObject.ikTargetType === rightObject.ikTargetType &&
      leftObject.orbitRadius === rightObject.orbitRadius &&
      leftObject.orbitInclination === rightObject.orbitInclination &&
      leftObject.orbitPhase === rightObject.orbitPhase &&
      leftObject.orbitSecondaryOffset === rightObject.orbitSecondaryOffset &&
      leftObject.orbitTargetPoint === rightObject.orbitTargetPoint &&
      leftObject.position.equals(rightObject.position) &&
      normalizeWorldObjectRotationEuler(leftObject.rotation).equals(
        normalizeWorldObjectRotationEuler(rightObject.rotation)
      ) &&
      leftObject.size.equals(rightObject.size)
    );
  });
};

const trimUndoStack = (undoStack: ObjectSnapshot[]): ObjectSnapshot[] =>
  undoStack.length > WORLD_OBJECT_STORE_PARAMS.historyLimit
    ? undoStack.slice(undoStack.length - WORLD_OBJECT_STORE_PARAMS.historyLimit)
    : undoStack;

export const useObjectStore = create<ObjectStore & ObjectStoreInternalState>((set, get) => ({
  objects: [],
  selectedObjectId: null,
  editMode: "move",
  transformSpace: "world",
  canUndo: false,
  canRedo: false,
  undoStack: [],
  redoStack: [],
  activeEditSnapshot: null,

  addObject: (object, options) => {
    const previousSnapshot = captureSnapshot(get());
    const id = `object-${objectIdCounter++}`;
    const resolvedPosition = normalizeWorldObjectPositionVector(object.position);
    const resolvedSize = normalizeWorldObjectSizeVector({
      type: object.type,
      size: object.size,
    });
    const newObject: CreatedObject = {
      ...object,
      id,
      position: resolvedPosition,
      rotation: normalizeWorldObjectRotationEuler(object.rotation),
      size: resolvedSize,
      isHidden: object.isHidden === true,
      source: object.source ?? "user",
      isIkTarget: object.isIkTarget ?? true,
      ikTargetType: object.ikTargetType ?? "punctual",
      orbitRadius: object.orbitRadius ?? 0.3,
      orbitInclination: object.orbitInclination ?? 45,
      orbitPhase: object.orbitPhase ?? 0,
      orbitSecondaryOffset: object.orbitSecondaryOffset ?? 180,
      orbitTargetPoint: object.orbitTargetPoint ?? "primary",
      label: object.label,
    };

    set((state) => {
      const shouldSelectObject = options?.select !== false;
      const nextSnapshot: ObjectSnapshot = {
        objects: [...state.objects, cloneCreatedObject(newObject)],
        selectedObjectId: shouldSelectObject ? id : state.selectedObjectId,
      };
      const trackHistory = options?.trackHistory !== false && !state.activeEditSnapshot;
      const undoStack = trackHistory
        ? trimUndoStack([...state.undoStack, previousSnapshot])
        : state.undoStack;
      return {
        objects: nextSnapshot.objects,
        selectedObjectId: nextSnapshot.selectedObjectId,
        undoStack,
        redoStack: trackHistory ? [] : state.redoStack,
        canUndo: undoStack.length > 0,
        canRedo: trackHistory ? false : state.redoStack.length > 0,
      };
    });

    return id;
  },

  duplicateObject: (id, options) => {
    const previousSnapshot = captureSnapshot(get());
    const sourceObject = get().objects.find((object) => object.id === id);
    if (!sourceObject) {
      return null;
    }
    const duplicateId = `object-${objectIdCounter++}`;
    const offset = new THREE.Vector3(
      WORLD_OBJECT_STORE_PARAMS.duplicateOffsetM.x,
      WORLD_OBJECT_STORE_PARAMS.duplicateOffsetM.y,
      WORLD_OBJECT_STORE_PARAMS.duplicateOffsetM.z
    );
    const duplicateObject = cloneCreatedObject({
      ...sourceObject,
      id: duplicateId,
      position: normalizeWorldObjectPositionVector(sourceObject.position.clone().add(offset)),
    });

    set((state) => {
      const nextSnapshot: ObjectSnapshot = {
        objects: [...state.objects, duplicateObject],
        selectedObjectId: duplicateId,
      };
      if (snapshotsEqual(previousSnapshot, nextSnapshot)) {
        return state;
      }
      const trackHistory = options?.trackHistory !== false && !state.activeEditSnapshot;
      const undoStack = trackHistory
        ? trimUndoStack([...state.undoStack, previousSnapshot])
        : state.undoStack;
      return {
        objects: nextSnapshot.objects,
        selectedObjectId: nextSnapshot.selectedObjectId,
        undoStack,
        redoStack: trackHistory ? [] : state.redoStack,
        canUndo: undoStack.length > 0,
        canRedo: trackHistory ? false : state.redoStack.length > 0,
      };
    });

    return duplicateId;
  },

  removeObject: (id, options) => {
    const previousSnapshot = captureSnapshot(get());
    set((state) => {
      const nextSnapshot: ObjectSnapshot = {
        objects: state.objects.filter((obj) => obj.id !== id),
        selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
      };
      if (snapshotsEqual(previousSnapshot, nextSnapshot)) {
        return state;
      }
      const trackHistory = options?.trackHistory !== false && !state.activeEditSnapshot;
      const undoStack = trackHistory
        ? trimUndoStack([...state.undoStack, previousSnapshot])
        : state.undoStack;
      return {
        objects: nextSnapshot.objects,
        selectedObjectId: nextSnapshot.selectedObjectId,
        undoStack,
        redoStack: trackHistory ? [] : state.redoStack,
        canUndo: undoStack.length > 0,
        canRedo: trackHistory ? false : state.redoStack.length > 0,
      };
    });
  },

  updateObjectPosition: (id, position, options) => {
    const previousSnapshot = captureSnapshot(get());
    const resolvedPosition = normalizeWorldObjectPositionVector(position);
    set((state) => {
      const nextSnapshot: ObjectSnapshot = {
        objects: state.objects.map((obj) =>
          obj.id === id ? { ...obj, position: resolvedPosition.clone() } : obj
        ),
        selectedObjectId: state.selectedObjectId,
      };
      if (snapshotsEqual(previousSnapshot, nextSnapshot)) {
        return state;
      }
      const trackHistory = options?.trackHistory !== false && !state.activeEditSnapshot;
      const undoStack = trackHistory
        ? trimUndoStack([...state.undoStack, previousSnapshot])
        : state.undoStack;
      return {
        objects: nextSnapshot.objects,
        undoStack,
        redoStack: trackHistory ? [] : state.redoStack,
        canUndo: undoStack.length > 0,
        canRedo: trackHistory ? false : state.redoStack.length > 0,
      };
    });
  },

  updateObjectRotation: (id, rotation, options) => {
    const previousSnapshot = captureSnapshot(get());
    const resolvedRotation = normalizeWorldObjectRotationEuler(rotation);
    set((state) => {
      const nextSnapshot: ObjectSnapshot = {
        objects: state.objects.map((obj) =>
          obj.id === id ? { ...obj, rotation: resolvedRotation.clone() } : obj
        ),
        selectedObjectId: state.selectedObjectId,
      };
      if (snapshotsEqual(previousSnapshot, nextSnapshot)) {
        return state;
      }
      const trackHistory = options?.trackHistory !== false && !state.activeEditSnapshot;
      const undoStack = trackHistory
        ? trimUndoStack([...state.undoStack, previousSnapshot])
        : state.undoStack;
      return {
        objects: nextSnapshot.objects,
        undoStack,
        redoStack: trackHistory ? [] : state.redoStack,
        canUndo: undoStack.length > 0,
        canRedo: trackHistory ? false : state.redoStack.length > 0,
      };
    });
  },

  updateObjectSize: (id, size, options) => {
    const previousSnapshot = captureSnapshot(get());
    set((state) => {
      const nextSnapshot: ObjectSnapshot = {
        objects: state.objects.map((obj) =>
          obj.id === id
            ? {
                ...obj,
                size: normalizeWorldObjectSizeVector({ type: obj.type, size }),
              }
            : obj
        ),
        selectedObjectId: state.selectedObjectId,
      };
      if (snapshotsEqual(previousSnapshot, nextSnapshot)) {
        return state;
      }
      const trackHistory = options?.trackHistory !== false && !state.activeEditSnapshot;
      const undoStack = trackHistory
        ? trimUndoStack([...state.undoStack, previousSnapshot])
        : state.undoStack;
      return {
        objects: nextSnapshot.objects,
        undoStack,
        redoStack: trackHistory ? [] : state.redoStack,
        canUndo: undoStack.length > 0,
        canRedo: trackHistory ? false : state.redoStack.length > 0,
      };
    });
  },

  setObjectHidden: (id, isHidden) => {
    set((state) => ({
      objects: state.objects.map((obj) =>
        obj.id === id ? { ...obj, isHidden } : obj
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
    set((state) => ({
      selectedObjectId: id,
      editMode: id === null ? state.editMode : "move",
    }));
  },

  setEditMode: (mode) => {
    set({ editMode: mode });
  },

  setTransformSpace: (space) => {
    set({ transformSpace: space });
  },

  clearObjects: () => {
    set({
      objects: [],
      selectedObjectId: null,
      editMode: "move",
      transformSpace: "world",
      undoStack: [],
      redoStack: [],
      activeEditSnapshot: null,
      canUndo: false,
      canRedo: false,
    });
  },

  replaceObjectsBySource: (source, objects) => {
    const normalizedObjects: CreatedObject[] = objects.map((object, index) => ({
      ...object,
      id: `${source}-${index}`,
      position: normalizeWorldObjectPositionVector(object.position),
      rotation: normalizeWorldObjectRotationEuler(object.rotation),
      size: normalizeWorldObjectSizeVector({
        type: object.type,
        size: object.size,
      }),
      source,
      isHidden: object.isHidden === true,
      isIkTarget: object.isIkTarget ?? false,
      ikTargetType: object.ikTargetType ?? "punctual",
      orbitRadius: object.orbitRadius ?? 0.3,
      orbitInclination: object.orbitInclination ?? 45,
      orbitPhase: object.orbitPhase ?? 0,
      orbitSecondaryOffset: object.orbitSecondaryOffset ?? 180,
      orbitTargetPoint: object.orbitTargetPoint ?? "primary",
      label: object.label,
    }));
    set((state) => ({
      objects: [
        ...state.objects.filter((object) => object.source !== source),
        ...normalizedObjects,
      ],
      editMode: "move",
      transformSpace: "world",
      selectedObjectId:
        state.selectedObjectId &&
        normalizedObjects.some((object) => object.id === state.selectedObjectId)
          ? state.selectedObjectId
          : state.selectedObjectId &&
              state.objects.some(
                (object) =>
                  object.id === state.selectedObjectId && object.source !== source
              )
            ? state.selectedObjectId
            : null,
      undoStack: [],
      redoStack: [],
      activeEditSnapshot: null,
      canUndo: false,
      canRedo: false,
    }));
  },

  undo: () => {
    const state = get();
    const previousSnapshot = state.undoStack[state.undoStack.length - 1];
    if (!previousSnapshot) {
      return;
    }
    const currentSnapshot = captureSnapshot(state);
    const nextUndoStack = state.undoStack.slice(0, -1);
    set({
      objects: previousSnapshot.objects.map(cloneCreatedObject),
      selectedObjectId: previousSnapshot.selectedObjectId,
      undoStack: nextUndoStack,
      redoStack: [...state.redoStack, currentSnapshot],
      activeEditSnapshot: null,
      canUndo: nextUndoStack.length > 0,
      canRedo: true,
    });
  },

  redo: () => {
    const state = get();
    const nextSnapshot = state.redoStack[state.redoStack.length - 1];
    if (!nextSnapshot) {
      return;
    }
    const currentSnapshot = captureSnapshot(state);
    const nextRedoStack = state.redoStack.slice(0, -1);
    const nextUndoStack = trimUndoStack([...state.undoStack, currentSnapshot]);
    set({
      objects: nextSnapshot.objects.map(cloneCreatedObject),
      selectedObjectId: nextSnapshot.selectedObjectId,
      undoStack: nextUndoStack,
      redoStack: nextRedoStack,
      activeEditSnapshot: null,
      canUndo: nextUndoStack.length > 0,
      canRedo: nextRedoStack.length > 0,
    });
  },

  beginEditSession: () => {
    const state = get();
    if (state.activeEditSnapshot) {
      return;
    }
    set({
      activeEditSnapshot: captureSnapshot(state),
    });
  },

  endEditSession: () => {
    const state = get();
    const startSnapshot = state.activeEditSnapshot;
    if (!startSnapshot) {
      return;
    }
    const currentSnapshot = captureSnapshot(state);
    if (snapshotsEqual(startSnapshot, currentSnapshot)) {
      set({ activeEditSnapshot: null });
      return;
    }
    const nextUndoStack = trimUndoStack([...state.undoStack, startSnapshot]);
    set({
      undoStack: nextUndoStack,
      redoStack: [],
      activeEditSnapshot: null,
      canUndo: nextUndoStack.length > 0,
      canRedo: false,
    });
  },

  cancelEditSession: () => {
    const state = get();
    const startSnapshot = state.activeEditSnapshot;
    if (!startSnapshot) {
      return;
    }
    set({
      objects: startSnapshot.objects.map(cloneCreatedObject),
      selectedObjectId: startSnapshot.selectedObjectId,
      activeEditSnapshot: null,
      canUndo: state.undoStack.length > 0,
      canRedo: state.redoStack.length > 0,
    });
  },
}));
