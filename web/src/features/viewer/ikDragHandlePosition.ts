import * as THREE from "three";

type SyncVisibleIkDragHandlePositionParams = {
  currentPosition: THREE.Vector3;
  desiredTargetWorld: THREE.Vector3;
};

export const syncVisibleIkDragHandlePosition = ({
  currentPosition,
  desiredTargetWorld,
}: SyncVisibleIkDragHandlePositionParams): THREE.Vector3 =>
  currentPosition.copy(desiredTargetWorld);
