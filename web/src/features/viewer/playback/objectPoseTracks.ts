import * as THREE from "three";
import { useObjectStore, type CreatedObject } from "@/features/objects";
import { normalizeWorldObjectRotationEuler } from "@/features/objects/worldObjectGeometry";
import type { ViewerObjectFramePoseMap } from "@/shared/types/feature";

type ObjectPoseStore = Pick<
  ReturnType<typeof useObjectStore.getState>,
  | "objects"
  | "setObjectHidden"
  | "updateObjectPosition"
  | "updateObjectRotation"
>;

const POSITION_EPSILON_SQ = 1e-10;
const ROTATION_EPSILON_RAD = 1e-6;

const normalizeTrackId = (value: string | undefined): string =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const findPlaybackObjectByTrackId = (
  objects: readonly CreatedObject[],
  trackId: string
): CreatedObject | null => {
  const normalizedTrackId = normalizeTrackId(trackId);
  if (!normalizedTrackId) return null;

  return (
    objects.find((object) => normalizeTrackId(object.id) === normalizedTrackId) ??
    objects.find((object) => normalizeTrackId(object.label) === normalizedTrackId) ??
    null
  );
};

const rotationChanged = (left: THREE.Euler, right: THREE.Euler): boolean =>
  Math.abs(left.x - right.x) > ROTATION_EPSILON_RAD ||
  Math.abs(left.y - right.y) > ROTATION_EPSILON_RAD ||
  Math.abs(left.z - right.z) > ROTATION_EPSILON_RAD;

export const applyPlaybackObjectPoses = (
  objectPoses: ViewerObjectFramePoseMap | null | undefined,
  store: ObjectPoseStore = useObjectStore.getState()
): void => {
  if (!objectPoses) return;

  Object.entries(objectPoses).forEach(([trackId, pose]) => {
    const targetObject = findPlaybackObjectByTrackId(store.objects, trackId);
    if (!targetObject) return;

    const nextPosition = new THREE.Vector3(
      pose.position.x,
      pose.position.y,
      pose.position.z
    );
    if (targetObject.position.distanceToSquared(nextPosition) > POSITION_EPSILON_SQ) {
      store.updateObjectPosition(targetObject.id, nextPosition, { trackHistory: false });
    }

    if (pose.rotation) {
      const currentRotation = normalizeWorldObjectRotationEuler(targetObject.rotation);
      const nextRotation = new THREE.Euler(
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        "XYZ"
      );
      if (rotationChanged(currentRotation, nextRotation)) {
        store.updateObjectRotation(targetObject.id, nextRotation, { trackHistory: false });
      }
    }

    if (
      pose.isHidden !== undefined &&
      Boolean(targetObject.isHidden) !== pose.isHidden
    ) {
      store.setObjectHidden(targetObject.id, pose.isHidden);
    }
  });
};
