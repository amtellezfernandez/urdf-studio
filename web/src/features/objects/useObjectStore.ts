import { create } from "zustand";
import * as THREE from "three";
import {
  normalizeWorldObjectPositionVector,
  normalizeWorldObjectRotationEuler,
  normalizeWorldObjectSizeVector,
  type WorldObjectPrimitiveType,
} from "./worldObjectGeometry";
import { WORLD_OBJECT_STORE_PARAMS } from "./worldObjectStoreParams";
import { cloneJsonSerializableValue } from "@/shared/lib/jsonSerializableClone";
import type { WorldObjectSource } from "@/shared/types/worldObject";
import type { SerializableWorldObject } from "@/features/world-share/worldScenePackageTypes";

export type CreatedObjectWorldMetadata = Pick<
  SerializableWorldObject,
  "appearance" | "consistency" | "mesh" | "physics" | "simulation"
>;

export interface CreatedObject {
  id: string;
  label?: string;
  type: WorldObjectPrimitiveType;
  position: THREE.Vector3;
  rotation?: THREE.Euler;
  size: THREE.Vector3;
  color: string;
  assetRef?: string;
  assetScale?: THREE.Vector3;
  meshUri?: string;
  isHidden?: boolean;
  source?: WorldObjectSource;
  worldMetadata?: CreatedObjectWorldMetadata;
  trackedJointName: string | null;
  isIkTarget: boolean;
  ikTargetType?: "punctual" | "orbit";
  orbitRadius?: number;
  orbitInclination?: number; // in degrees
  orbitPhase?: number; // current position on orbit (0-360 degrees)
  orbitSecondaryOffset?: number; // degrees offset between orbit markers
  orbitTargetPoint?: "center" | "primary" | "secondary"; // which point to use for IK
}

type ObjectMutationOptions = { trackHistory?: boolean };
type CreatedObjectInput = Omit<CreatedObject, "id"> &
  Partial<Pick<CreatedObject, "id">>;
type CreatedObjectNormalizationOptions = {
  id: string;
  source: WorldObjectSource;
  defaultIsIkTarget: boolean;
};

interface ObjectStore {
  objects: CreatedObject[];
  selectedObjectId: string | null;
  editMode: "move" | "resize" | "rotate";
  transformSpace: "world" | "local";
  canUndo: boolean;
  canRedo: boolean;
  addObject: (
    object: CreatedObjectInput,
    options?: ObjectMutationOptions & { select?: boolean },
  ) => string;
  duplicateObject: (
    id: string,
    options?: ObjectMutationOptions,
  ) => string | null;
  removeObject: (id: string, options?: ObjectMutationOptions) => void;
  updateObjectPosition: (
    id: string,
    position: THREE.Vector3,
    options?: ObjectMutationOptions,
  ) => void;
  updateObjectRotation: (
    id: string,
    rotation: THREE.Euler,
    options?: ObjectMutationOptions,
  ) => void;
  updateObjectSize: (
    id: string,
    size: THREE.Vector3,
    options?: ObjectMutationOptions,
  ) => void;
  setObjectHidden: (id: string, isHidden: boolean) => void;
  updateTrackedJoint: (id: string, jointName: string | null) => void;
  updateIkTargetType: (id: string, ikTargetType: "punctual" | "orbit") => void;
  updateOrbitParams: (
    id: string,
    params: {
      radius?: number;
      inclination?: number;
      phase?: number;
      secondaryOffset?: number;
    },
  ) => void;
  updateOrbitTargetPoint: (
    id: string,
    targetPoint: "center" | "primary" | "secondary",
  ) => void;
  setSelectedObject: (id: string | null) => void;
  setEditMode: (mode: "move" | "resize" | "rotate") => void;
  setTransformSpace: (space: "world" | "local") => void;
  clearObjects: () => void;
  replaceObjectsBySource: (
    source: WorldObjectSource,
    objects: Omit<CreatedObject, "id">[],
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

type ObjectStoreState = ObjectStore & ObjectStoreInternalState;
type ObjectStoreStatePatch = Partial<ObjectStoreState> | ObjectStoreState;

const cloneCreatedObjectWorldMetadata = (
  metadata: CreatedObjectWorldMetadata | undefined,
): CreatedObjectWorldMetadata | undefined => {
  if (!metadata) return undefined;
  return cloneJsonSerializableValue(metadata);
};

const cloneCreatedObject = (object: CreatedObject): CreatedObject => ({
  ...object,
  position: object.position.clone(),
  rotation: normalizeWorldObjectRotationEuler(object.rotation),
  size: object.size.clone(),
  assetScale: object.assetScale?.clone(),
  worldMetadata: cloneCreatedObjectWorldMetadata(object.worldMetadata),
});

const cloneSnapshot = (snapshot: ObjectSnapshot): ObjectSnapshot => ({
  objects: snapshot.objects.map(cloneCreatedObject),
  selectedObjectId: snapshot.selectedObjectId,
});

const optionalVectorEquals = (
  left: THREE.Vector3 | undefined,
  right: THREE.Vector3 | undefined,
): boolean => {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.equals(right);
};

const captureSnapshot = (
  state: Pick<ObjectStore, "objects" | "selectedObjectId">,
): ObjectSnapshot =>
  cloneSnapshot({
    objects: state.objects,
    selectedObjectId: state.selectedObjectId,
  });

const snapshotsEqual = (
  left: ObjectSnapshot,
  right: ObjectSnapshot,
): boolean => {
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
      leftObject.assetRef === rightObject.assetRef &&
      optionalVectorEquals(leftObject.assetScale, rightObject.assetScale) &&
      leftObject.meshUri === rightObject.meshUri &&
      leftObject.isHidden === rightObject.isHidden &&
      leftObject.source === rightObject.source &&
      JSON.stringify(leftObject.worldMetadata) ===
        JSON.stringify(rightObject.worldMetadata) &&
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
        normalizeWorldObjectRotationEuler(rightObject.rotation),
      ) &&
      leftObject.size.equals(rightObject.size)
    );
  });
};

const trimUndoStack = (undoStack: ObjectSnapshot[]): ObjectSnapshot[] =>
  undoStack.length > WORLD_OBJECT_STORE_PARAMS.historyLimit
    ? undoStack.slice(undoStack.length - WORLD_OBJECT_STORE_PARAMS.historyLimit)
    : undoStack;

const nextGeneratedObjectId = (existingIds: Set<string>): string => {
  let id = `object-${objectIdCounter++}`;
  while (existingIds.has(id)) {
    id = `object-${objectIdCounter++}`;
  }
  return id;
};

const resolveAddedObjectId = (
  object: Partial<Pick<CreatedObject, "id">>,
  existingIds: Set<string>,
): string => {
  const requestedId = typeof object.id === "string" ? object.id.trim() : "";
  if (requestedId && !existingIds.has(requestedId)) return requestedId;
  return nextGeneratedObjectId(existingIds);
};

const normalizeCreatedObject = (
  object: CreatedObjectInput,
  options: CreatedObjectNormalizationOptions,
): CreatedObject => ({
  ...object,
  id: options.id,
  position: normalizeWorldObjectPositionVector(object.position),
  rotation: normalizeWorldObjectRotationEuler(object.rotation),
  size: normalizeWorldObjectSizeVector({
    type: object.type,
    size: object.size,
  }),
  isHidden: object.isHidden === true,
  source: options.source,
  isIkTarget: object.isIkTarget ?? options.defaultIsIkTarget,
  ikTargetType: object.ikTargetType ?? "punctual",
  orbitRadius: object.orbitRadius ?? 0.3,
  orbitInclination: object.orbitInclination ?? 45,
  orbitPhase: object.orbitPhase ?? 0,
  orbitSecondaryOffset: object.orbitSecondaryOffset ?? 180,
  orbitTargetPoint: object.orbitTargetPoint ?? "primary",
  label: object.label,
  assetRef: object.assetRef,
  assetScale: object.assetScale?.clone(),
  meshUri: object.meshUri,
  worldMetadata: cloneCreatedObjectWorldMetadata(object.worldMetadata),
});

const updateObjectById = (
  objects: CreatedObject[],
  id: string,
  updater: (object: CreatedObject) => CreatedObject,
): CreatedObject[] =>
  objects.map((object) => (object.id === id ? updater(object) : object));

const applyObjectSnapshotMutation = (
  state: ObjectStoreState,
  previousSnapshot: ObjectSnapshot,
  nextSnapshot: ObjectSnapshot,
  options?: ObjectMutationOptions,
): ObjectStoreStatePatch => {
  if (snapshotsEqual(previousSnapshot, nextSnapshot)) {
    return state;
  }
  const trackHistory =
    options?.trackHistory !== false && !state.activeEditSnapshot;
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
};

export const useObjectStore = create<ObjectStore & ObjectStoreInternalState>(
  (set, get) => ({
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
      const state = get();
      const previousSnapshot = captureSnapshot(state);
      const id = resolveAddedObjectId(
        object,
        new Set(state.objects.map((existingObject) => existingObject.id)),
      );
      const newObject = normalizeCreatedObject(object, {
        id,
        source: object.source ?? "user",
        defaultIsIkTarget: true,
      });

      set((state) => {
        const shouldSelectObject = options?.select !== false;
        const nextSnapshot: ObjectSnapshot = {
          objects: [...state.objects, cloneCreatedObject(newObject)],
          selectedObjectId: shouldSelectObject ? id : state.selectedObjectId,
        };
        return applyObjectSnapshotMutation(
          state,
          previousSnapshot,
          nextSnapshot,
          options,
        );
      });

      return id;
    },

    duplicateObject: (id, options) => {
      const state = get();
      const previousSnapshot = captureSnapshot(state);
      const sourceObject = state.objects.find((object) => object.id === id);
      if (!sourceObject) {
        return null;
      }
      const duplicateId = nextGeneratedObjectId(
        new Set(state.objects.map((object) => object.id)),
      );
      const offset = new THREE.Vector3(
        WORLD_OBJECT_STORE_PARAMS.duplicateOffsetM.x,
        WORLD_OBJECT_STORE_PARAMS.duplicateOffsetM.y,
        WORLD_OBJECT_STORE_PARAMS.duplicateOffsetM.z,
      );
      const duplicateObject = cloneCreatedObject({
        ...sourceObject,
        id: duplicateId,
        position: normalizeWorldObjectPositionVector(
          sourceObject.position.clone().add(offset),
        ),
      });

      set((state) => {
        const nextSnapshot: ObjectSnapshot = {
          objects: [...state.objects, duplicateObject],
          selectedObjectId: duplicateId,
        };
        if (snapshotsEqual(previousSnapshot, nextSnapshot)) {
          return state;
        }
        return applyObjectSnapshotMutation(
          state,
          previousSnapshot,
          nextSnapshot,
          options,
        );
      });

      return duplicateId;
    },

    removeObject: (id, options) => {
      const previousSnapshot = captureSnapshot(get());
      set((state) => {
        const nextSnapshot: ObjectSnapshot = {
          objects: state.objects.filter((obj) => obj.id !== id),
          selectedObjectId:
            state.selectedObjectId === id ? null : state.selectedObjectId,
        };
        return applyObjectSnapshotMutation(
          state,
          previousSnapshot,
          nextSnapshot,
          options,
        );
      });
    },

    updateObjectPosition: (id, position, options) => {
      const previousSnapshot = captureSnapshot(get());
      const resolvedPosition = normalizeWorldObjectPositionVector(position);
      set((state) => {
        const nextSnapshot: ObjectSnapshot = {
          objects: updateObjectById(state.objects, id, (object) =>
            cloneCreatedObject({ ...object, position: resolvedPosition }),
          ),
          selectedObjectId: state.selectedObjectId,
        };
        return applyObjectSnapshotMutation(
          state,
          previousSnapshot,
          nextSnapshot,
          options,
        );
      });
    },

    updateObjectRotation: (id, rotation, options) => {
      const previousSnapshot = captureSnapshot(get());
      const resolvedRotation = normalizeWorldObjectRotationEuler(rotation);
      set((state) => {
        const nextSnapshot: ObjectSnapshot = {
          objects: updateObjectById(state.objects, id, (object) =>
            cloneCreatedObject({ ...object, rotation: resolvedRotation }),
          ),
          selectedObjectId: state.selectedObjectId,
        };
        return applyObjectSnapshotMutation(
          state,
          previousSnapshot,
          nextSnapshot,
          options,
        );
      });
    },

    updateObjectSize: (id, size, options) => {
      const previousSnapshot = captureSnapshot(get());
      set((state) => {
        const nextSnapshot: ObjectSnapshot = {
          objects: updateObjectById(state.objects, id, (object) =>
            cloneCreatedObject({
              ...object,
              size: normalizeWorldObjectSizeVector({ type: object.type, size }),
            }),
          ),
          selectedObjectId: state.selectedObjectId,
        };
        return applyObjectSnapshotMutation(
          state,
          previousSnapshot,
          nextSnapshot,
          options,
        );
      });
    },

    setObjectHidden: (id, isHidden) => {
      set((state) => ({
        objects: updateObjectById(state.objects, id, (object) =>
          cloneCreatedObject({ ...object, isHidden }),
        ),
      }));
    },

    updateTrackedJoint: (id, jointName) => {
      set((state) => ({
        objects: updateObjectById(state.objects, id, (object) =>
          cloneCreatedObject({ ...object, trackedJointName: jointName }),
        ),
      }));
    },

    updateIkTargetType: (id, ikTargetType) => {
      set((state) => ({
        objects: updateObjectById(state.objects, id, (object) =>
          cloneCreatedObject({ ...object, ikTargetType }),
        ),
      }));
    },

    updateOrbitParams: (id, params) => {
      set((state) => ({
        objects: updateObjectById(state.objects, id, (object) =>
          cloneCreatedObject({
            ...object,
            orbitRadius:
              params.radius !== undefined ? params.radius : object.orbitRadius,
            orbitInclination:
              params.inclination !== undefined
                ? params.inclination
                : object.orbitInclination,
            orbitPhase:
              params.phase !== undefined ? params.phase : object.orbitPhase,
            orbitSecondaryOffset:
              params.secondaryOffset !== undefined
                ? params.secondaryOffset
                : object.orbitSecondaryOffset,
          }),
        ),
      }));
    },

    updateOrbitTargetPoint: (id, targetPoint) => {
      set((state) => ({
        objects: updateObjectById(state.objects, id, (object) =>
          cloneCreatedObject({ ...object, orbitTargetPoint: targetPoint }),
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
      const normalizedObjects: CreatedObject[] = objects.map((object, index) =>
        normalizeCreatedObject(object, {
          id: `${source}-${index}`,
          source,
          defaultIsIkTarget: false,
        }),
      );
      set((state) => ({
        objects: [
          ...state.objects.filter((object) => object.source !== source),
          ...normalizedObjects,
        ],
        editMode: "move",
        transformSpace: "world",
        selectedObjectId:
          state.selectedObjectId &&
          normalizedObjects.some(
            (object) => object.id === state.selectedObjectId,
          )
            ? state.selectedObjectId
            : state.selectedObjectId &&
                state.objects.some(
                  (object) =>
                    object.id === state.selectedObjectId &&
                    object.source !== source,
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
      const nextUndoStack = trimUndoStack([
        ...state.undoStack,
        currentSnapshot,
      ]);
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
  }),
);
