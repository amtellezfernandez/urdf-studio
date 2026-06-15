import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_POINT_SIZE } from "@/features/objects/objectCreatorHelpers";
import { WORLD_OBJECT_STORE_PARAMS } from "@/features/objects/worldObjectStoreParams";
import { useObjectStore } from "@/features/objects/useObjectStore";

const TEST_POINT_SIZE = 0.14;
const TEST_INVALID_POINT_SIZE = 0;
const TEST_CUBE_SIZE = 0.2;
const TEST_UPDATED_CUBE_SIZE = 0.3;
const TEST_OTHER_CUBE_SIZE = 0.4;
const TEST_ROTATION_Z_RAD = Math.PI / 3;
const TEST_UPDATED_ROTATION_Z_RAD = Math.PI / 2;

const resetObjectStore = () => {
  const store = useObjectStore.getState();
  store.clearObjects();
  store.setSelectedObject(null);
};

describe("useObjectStore", () => {
  beforeEach(() => {
    resetObjectStore();
  });

  it("preserves explicit imported object IDs", () => {
    const objectId = useObjectStore.getState().addObject({
      id: "warehouse-crate-a",
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    expect(objectId).toBe("warehouse-crate-a");
    expect(useObjectStore.getState().objects[0]?.id).toBe("warehouse-crate-a");
  });

  it("generates a unique object ID when an explicit imported ID already exists", () => {
    const store = useObjectStore.getState();
    store.addObject({
      id: "duplicate-world-object",
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    const secondObjectId = store.addObject({
      id: "duplicate-world-object",
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    expect(secondObjectId).not.toBe("duplicate-world-object");
    expect(new Set(useObjectStore.getState().objects.map((object) => object.id)).size).toBe(2);
  });

  it("preserves explicit imported point size on add", () => {
    const pointId = useObjectStore.getState().addObject({
      type: "point",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_POINT_SIZE, TEST_POINT_SIZE, TEST_POINT_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    const added = useObjectStore
      .getState()
      .objects.find((object) => object.id === pointId);

    expect(added?.size.x).toBe(TEST_POINT_SIZE);
    expect(added?.size.y).toBe(TEST_POINT_SIZE);
    expect(added?.size.z).toBe(TEST_POINT_SIZE);
  });

  it("falls back to default point size when imported size is invalid", () => {
    const pointId = useObjectStore.getState().addObject({
      type: "point",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(
        TEST_INVALID_POINT_SIZE,
        TEST_INVALID_POINT_SIZE,
        TEST_INVALID_POINT_SIZE
      ),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    const added = useObjectStore
      .getState()
      .objects.find((object) => object.id === pointId);

    expect(added?.size.x).toBe(DEFAULT_POINT_SIZE);
    expect(added?.size.y).toBe(DEFAULT_POINT_SIZE);
    expect(added?.size.z).toBe(DEFAULT_POINT_SIZE);
  });

  it("updates point size using the same normalization path as other primitives", () => {
    const pointId = useObjectStore.getState().addObject({
      type: "point",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_POINT_SIZE, TEST_POINT_SIZE, TEST_POINT_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    useObjectStore
      .getState()
      .updateObjectSize(pointId, new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE));

    const updated = useObjectStore
      .getState()
      .objects.find((object) => object.id === pointId);

    expect(updated?.size.x).toBe(TEST_CUBE_SIZE);
    expect(updated?.size.y).toBe(TEST_CUBE_SIZE);
    expect(updated?.size.z).toBe(TEST_CUBE_SIZE);
  });

  it("updates cube size", () => {
    const cubeId = useObjectStore.getState().addObject({
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    useObjectStore.getState().updateObjectSize(
      cubeId,
      new THREE.Vector3(TEST_UPDATED_CUBE_SIZE, TEST_UPDATED_CUBE_SIZE, TEST_UPDATED_CUBE_SIZE)
    );

    const updated = useObjectStore
      .getState()
      .objects.find((object) => object.id === cubeId);

    expect(updated?.size.x).toBe(TEST_UPDATED_CUBE_SIZE);
    expect(updated?.size.y).toBe(TEST_UPDATED_CUBE_SIZE);
    expect(updated?.size.z).toBe(TEST_UPDATED_CUBE_SIZE);
  });

  it("normalizes missing object rotation to zero", () => {
    const cubeId = useObjectStore.getState().addObject({
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    const added = useObjectStore
      .getState()
      .objects.find((object) => object.id === cubeId);

    expect(added?.rotation?.x).toBe(0);
    expect(added?.rotation?.y).toBe(0);
    expect(added?.rotation?.z).toBe(0);
  });

  it("updates cube rotation", () => {
    const cubeId = useObjectStore.getState().addObject({
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
      rotation: new THREE.Euler(0, 0, TEST_ROTATION_Z_RAD),
    });

    useObjectStore.getState().updateObjectRotation(
      cubeId,
      new THREE.Euler(0, 0, TEST_UPDATED_ROTATION_Z_RAD)
    );

    const updated = useObjectStore
      .getState()
      .objects.find((object) => object.id === cubeId);

    expect(updated?.rotation?.z).toBe(TEST_UPDATED_ROTATION_Z_RAD);
  });

  it("duplicates the selected object with an offset copy and selects it", () => {
    const store = useObjectStore.getState();
    const cubeId = store.addObject({
      type: "cube",
      position: new THREE.Vector3(1, 2, 3),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: "joint-1",
      isIkTarget: true,
      rotation: new THREE.Euler(0, 0, TEST_ROTATION_Z_RAD),
    });

    const duplicateId = store.duplicateObject(cubeId);
    const duplicate = useObjectStore
      .getState()
      .objects.find((object) => object.id === duplicateId);

    expect(duplicateId).not.toBeNull();
    expect(duplicate?.id).not.toBe(cubeId);
    expect(duplicate?.position.x).toBe(1 + WORLD_OBJECT_STORE_PARAMS.duplicateOffsetM.x);
    expect(duplicate?.position.y).toBe(2 + WORLD_OBJECT_STORE_PARAMS.duplicateOffsetM.y);
    expect(duplicate?.position.z).toBe(3 + WORLD_OBJECT_STORE_PARAMS.duplicateOffsetM.z);
    expect(duplicate?.rotation?.z).toBe(TEST_ROTATION_Z_RAD);
    expect(duplicate?.trackedJointName).toBe("joint-1");
    expect(useObjectStore.getState().selectedObjectId).toBe(duplicateId);
  });

  it("replaces runtime detection objects without touching user objects", () => {
    const store = useObjectStore.getState();
    store.addObject({
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      source: "user",
      isIkTarget: false,
    });

    store.replaceObjectsBySource("runtime-detection", [
      {
        type: "cube",
        position: new THREE.Vector3(1, 0.06, 2),
        size: new THREE.Vector3(0.12, 0.12, 0.12),
        color: "#ff8800",
        trackedJointName: null,
        source: "runtime-detection",
        isIkTarget: false,
      },
    ]);

    expect(useObjectStore.getState().objects).toHaveLength(2);
    expect(
      useObjectStore
        .getState()
        .objects.filter((object) => object.source === "runtime-detection")
    ).toHaveLength(1);

    store.replaceObjectsBySource("runtime-detection", []);

    const remainingObjects = useObjectStore.getState().objects;
    expect(remainingObjects).toHaveLength(1);
    expect(remainingObjects[0]?.source).toBe("user");
  });

  it("undoes and redoes a direct cube size edit", () => {
    const store = useObjectStore.getState();
    const cubeId = store.addObject({
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    store.updateObjectSize(
      cubeId,
      new THREE.Vector3(TEST_UPDATED_CUBE_SIZE, TEST_UPDATED_CUBE_SIZE, TEST_UPDATED_CUBE_SIZE)
    );
    expect(useObjectStore.getState().canUndo).toBe(true);

    store.undo();
    let current = useObjectStore.getState().objects.find((object) => object.id === cubeId);
    expect(current?.size.x).toBe(TEST_CUBE_SIZE);
    expect(useObjectStore.getState().canRedo).toBe(true);

    store.redo();
    current = useObjectStore.getState().objects.find((object) => object.id === cubeId);
    expect(current?.size.x).toBe(TEST_UPDATED_CUBE_SIZE);
  });

  it("batches edit sessions into a single undo step", () => {
    const store = useObjectStore.getState();
    const cubeId = store.addObject({
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    store.beginEditSession();
    store.updateObjectPosition(cubeId, new THREE.Vector3(1, 0, 0));
    store.updateObjectSize(
      cubeId,
      new THREE.Vector3(TEST_UPDATED_CUBE_SIZE, TEST_UPDATED_CUBE_SIZE, TEST_UPDATED_CUBE_SIZE)
    );
    store.updateObjectSize(
      cubeId,
      new THREE.Vector3(TEST_OTHER_CUBE_SIZE, TEST_OTHER_CUBE_SIZE, TEST_OTHER_CUBE_SIZE)
    );
    store.endEditSession();

    expect(useObjectStore.getState().canUndo).toBe(true);

    store.undo();
    const current = useObjectStore.getState().objects.find((object) => object.id === cubeId);
    expect(current?.position.x).toBe(0);
    expect(current?.size.x).toBe(TEST_CUBE_SIZE);
  });

  it("resets edit mode to move when clearing objects", () => {
    const store = useObjectStore.getState();
    store.setEditMode("rotate");
    store.setTransformSpace("local");

    store.clearObjects();

    expect(useObjectStore.getState().editMode).toBe("move");
    expect(useObjectStore.getState().transformSpace).toBe("world");
  });

  it("resets edit mode to move when selecting an object", () => {
    const store = useObjectStore.getState();
    const cubeId = store.addObject({
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });

    store.setEditMode("rotate");
    store.setSelectedObject(cubeId);

    expect(useObjectStore.getState().selectedObjectId).toBe(cubeId);
    expect(useObjectStore.getState().editMode).toBe("move");
  });

  it("cancels an edit session by restoring the starting snapshot", () => {
    const store = useObjectStore.getState();
    const cubeId = store.addObject({
      type: "cube",
      position: new THREE.Vector3(0, 0, 0),
      size: new THREE.Vector3(TEST_CUBE_SIZE, TEST_CUBE_SIZE, TEST_CUBE_SIZE),
      color: "#ffffff",
      trackedJointName: null,
      isIkTarget: true,
    });
    const canUndoBeforeEdit = useObjectStore.getState().canUndo;

    store.beginEditSession();
    store.updateObjectPosition(cubeId, new THREE.Vector3(1, 2, 3));
    store.updateObjectSize(
      cubeId,
      new THREE.Vector3(TEST_UPDATED_CUBE_SIZE, TEST_UPDATED_CUBE_SIZE, TEST_UPDATED_CUBE_SIZE)
    );

    store.cancelEditSession();

    const current = useObjectStore.getState().objects.find((object) => object.id === cubeId);
    expect(current?.position.x).toBe(0);
    expect(current?.position.y).toBe(0);
    expect(current?.position.z).toBe(0);
    expect(current?.size.x).toBe(TEST_CUBE_SIZE);
    expect(useObjectStore.getState().canUndo).toBe(canUndoBeforeEdit);

    store.undo();

    expect(useObjectStore.getState().objects).toHaveLength(0);
  });
});
