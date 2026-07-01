import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import { useJointStore } from "@/shared/store/useJointStore";
import type { CreatedObject } from "@/features/objects";
import { useObjectStore } from "@/features/objects";
import { normalizeWorldObjectRotationEuler } from "@/features/objects/worldObjectGeometry";
import { resolveEndEffectorContactObjectId } from "@/features/viewer/eeObjectContact";
import {
  EE_OBJECT_GRASP_PARAMS,
  isGraspableWorldObject,
  resolveGripperGraspState,
} from "@/features/viewer/eeObjectGrasp";

type ContactObjectSetter = (
  updater: (previous: string | null) => string | null,
) => void;

type HeldObjectGrasp = {
  objectId: string;
  localOffsetFromEndEffector: THREE.Vector3;
  localQuaternionFromEndEffector: THREE.Quaternion;
};

type ObjectStoreState = ReturnType<typeof useObjectStore.getState>;

export const useEndEffectorObjectGrasp = ({
  enabled,
  endEffectorLink,
  jointLimits,
  objects,
  resolveLinkObject,
  setContactObjectId,
}: {
  enabled: boolean;
  endEffectorLink: string | null;
  jointLimits?: JointLimits;
  objects: readonly CreatedObject[];
  resolveLinkObject: (linkName: string) => THREE.Object3D | null;
  setContactObjectId: ContactObjectSetter;
}) => {
  const updateObjectPosition = useObjectStore((state) => state.updateObjectPosition);
  const updateObjectRotation = useObjectStore((state) => state.updateObjectRotation);
  const endEffectorBoundsBoxRef = useRef(new THREE.Box3());
  const endEffectorSphereRef = useRef(new THREE.Sphere());
  const endEffectorQuaternionRef = useRef(new THREE.Quaternion());
  const graspAnchorPositionRef = useRef(new THREE.Vector3());
  const graspInverseQuaternionRef = useRef(new THREE.Quaternion());
  const graspNextPositionRef = useRef(new THREE.Vector3());
  const graspObjectQuaternionRef = useRef(new THREE.Quaternion());
  const graspNextQuaternionRef = useRef(new THREE.Quaternion());
  const graspNextRotationRef = useRef(new THREE.Euler());
  const heldObjectGraspRef = useRef<HeldObjectGrasp | null>(null);

  useFrame(() => {
    if (!enabled || !endEffectorLink) {
      heldObjectGraspRef.current = null;
      setContactObjectId((previous) => (previous === null ? previous : null));
      return;
    }
    const endEffectorObject = resolveLinkObject(endEffectorLink);
    if (!endEffectorObject) {
      heldObjectGraspRef.current = null;
      setContactObjectId((previous) => (previous === null ? previous : null));
      return;
    }

    endEffectorObject.updateMatrixWorld(true);
    endEffectorBoundsBoxRef.current.makeEmpty();
    endEffectorBoundsBoxRef.current.setFromObject(endEffectorObject);
    if (endEffectorBoundsBoxRef.current.isEmpty()) {
      heldObjectGraspRef.current = null;
      setContactObjectId((previous) => (previous === null ? previous : null));
      return;
    }

    endEffectorBoundsBoxRef.current.getBoundingSphere(endEffectorSphereRef.current);
    endEffectorObject.getWorldQuaternion(endEffectorQuaternionRef.current);
    graspAnchorPositionRef.current.copy(endEffectorSphereRef.current.center);
    const gripperState = resolveGripperGraspState({
      jointValues: useJointStore.getState().jointValues,
      jointLimits,
      holding: heldObjectGraspRef.current !== null,
    });
    const heldObjectGrasp = heldObjectGraspRef.current;
    if (heldObjectGrasp) {
      const heldObject =
        objects.find((object) => object.id === heldObjectGrasp.objectId) ?? null;
      if (!heldObject || heldObject.isHidden === true || gripperState === "released") {
        heldObjectGraspRef.current = null;
      } else {
        updateHeldObjectPose({
          heldObject,
          heldObjectGrasp,
          endEffectorQuaternion: endEffectorQuaternionRef.current,
          graspAnchorPosition: graspAnchorPositionRef.current,
          nextPosition: graspNextPositionRef.current,
          currentQuaternion: graspObjectQuaternionRef.current,
          nextQuaternion: graspNextQuaternionRef.current,
          nextRotation: graspNextRotationRef.current,
          updateObjectPosition,
          updateObjectRotation,
        });
        setContactObjectId((previous) =>
          previous === heldObject.id ? previous : heldObject.id,
        );
        return;
      }
    }

    const nextContactObjectId = resolveEndEffectorContactObjectId({
      endEffectorSphereWorld: endEffectorSphereRef.current,
      objects,
    });
    if (gripperState === "engaged") {
      const graspObject = resolveNextGraspObject({
        endEffectorSphereWorld: endEffectorSphereRef.current,
        objects,
      });
      if (graspObject) {
        heldObjectGraspRef.current = createHeldObjectGrasp({
          graspObject,
          endEffectorQuaternion: endEffectorQuaternionRef.current,
          graspAnchorPosition: graspAnchorPositionRef.current,
          inverseEndEffectorQuaternion: graspInverseQuaternionRef.current,
          objectQuaternion: graspObjectQuaternionRef.current,
        });
        setContactObjectId((previous) =>
          previous === graspObject.id ? previous : graspObject.id,
        );
        return;
      }
    }
    setContactObjectId((previous) =>
      previous === nextContactObjectId ? previous : nextContactObjectId,
    );
  });
};

const updateHeldObjectPose = ({
  heldObject,
  heldObjectGrasp,
  endEffectorQuaternion,
  graspAnchorPosition,
  nextPosition,
  currentQuaternion,
  nextQuaternion,
  nextRotation,
  updateObjectPosition,
  updateObjectRotation,
}: {
  heldObject: CreatedObject;
  heldObjectGrasp: HeldObjectGrasp;
  endEffectorQuaternion: THREE.Quaternion;
  graspAnchorPosition: THREE.Vector3;
  nextPosition: THREE.Vector3;
  currentQuaternion: THREE.Quaternion;
  nextQuaternion: THREE.Quaternion;
  nextRotation: THREE.Euler;
  updateObjectPosition: ObjectStoreState["updateObjectPosition"];
  updateObjectRotation: ObjectStoreState["updateObjectRotation"];
}) => {
  nextPosition
    .copy(heldObjectGrasp.localOffsetFromEndEffector)
    .applyQuaternion(endEffectorQuaternion)
    .add(graspAnchorPosition);
  if (
    heldObject.position.distanceToSquared(nextPosition) >
    EE_OBJECT_GRASP_PARAMS.positionUpdateEpsilonSq
  ) {
    updateObjectPosition(heldObject.id, nextPosition, { trackHistory: false });
  }
  nextQuaternion
    .copy(endEffectorQuaternion)
    .multiply(heldObjectGrasp.localQuaternionFromEndEffector);
  currentQuaternion.setFromEuler(normalizeWorldObjectRotationEuler(heldObject.rotation));
  if (currentQuaternion.angleTo(nextQuaternion) > 1e-4) {
    updateObjectRotation(heldObject.id, nextRotation.setFromQuaternion(nextQuaternion), {
      trackHistory: false,
    });
  }
};

const resolveNextGraspObject = ({
  endEffectorSphereWorld,
  objects,
}: {
  endEffectorSphereWorld: THREE.Sphere;
  objects: readonly CreatedObject[];
}): CreatedObject | null => {
  const graspableObjects = objects.filter(isGraspableWorldObject);
  const objectId = resolveEndEffectorContactObjectId({
    endEffectorSphereWorld,
    objects: graspableObjects,
  });
  return graspableObjects.find((object) => object.id === objectId) ?? null;
};

const createHeldObjectGrasp = ({
  graspObject,
  endEffectorQuaternion,
  graspAnchorPosition,
  inverseEndEffectorQuaternion,
  objectQuaternion,
}: {
  graspObject: CreatedObject;
  endEffectorQuaternion: THREE.Quaternion;
  graspAnchorPosition: THREE.Vector3;
  inverseEndEffectorQuaternion: THREE.Quaternion;
  objectQuaternion: THREE.Quaternion;
}): HeldObjectGrasp => {
  const inverseQuaternion = inverseEndEffectorQuaternion
    .copy(endEffectorQuaternion)
    .invert();
  return {
    objectId: graspObject.id,
    localOffsetFromEndEffector: graspObject.position
      .clone()
      .sub(graspAnchorPosition)
      .applyQuaternion(inverseQuaternion),
    localQuaternionFromEndEffector: inverseQuaternion
      .clone()
      .multiply(
        objectQuaternion.setFromEuler(
          normalizeWorldObjectRotationEuler(graspObject.rotation),
        ),
      ),
  };
};
