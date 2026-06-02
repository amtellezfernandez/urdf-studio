import * as THREE from "three";
import type { RigidFrame } from "@/shared/lib/spatialFrame";

export type DragRuntimeConfig = {
  inputHz: number;
  solveHz: number;
  maxHandleLeadM: number;
  floorZ: number;
  floorEpsilon: number;
  collisionMargin: number;
  fastCollisionTolerance: number;
  fastFloorToleranceM: number;
  releaseCollisionTolerance: number;
  releaseFloorToleranceM: number;
};

export type DragTargetLocal = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

export type DragSolveTicket = {
  sequenceId: number;
  submittedAtMs: number;
  targetLocal: DragTargetLocal;
};

export type CollisionProxyEntry = {
  mesh: THREE.Mesh;
  linkName: string;
  localSphereCenter: THREE.Vector3;
  localSphereRadius: number;
};

export type DragRuntimeCache = {
  chainJointNames: Set<string> | null;
  adjacentLinkPairs: Set<string>;
  collisionProxies: CollisionProxyEntry[];
  baseLinkName: string | null;
  reachRadius: number | null;
  axesLocal: {
    forward: THREE.Vector3;
    right: THREE.Vector3;
    up: THREE.Vector3;
  };
  robotWorldFrame: RigidFrame;
  robotToWorldMatrix: THREE.Matrix4;
  worldToRobotMatrix: THREE.Matrix4;
};

export type FastSafetyResult = {
  safe: boolean;
  floorClear: boolean;
  floorPenetration: number;
  collisionPairs: number;
  eeDistance: number;
};
