import * as THREE from "three";
import type { RigidFrame } from "@/shared/lib/spatialFrame";

export type DragTargetLocal = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

export type DragSolveTicket = {
  sequenceId: number;
  submittedAtMs: number;
  targetLocal: DragTargetLocal;
};

export type DragRuntimeCache = {
  chainJointNames: Set<string> | null;
  baseLinkName: string | null;
  reachRadius: number | null;
  robotWorldFrame: RigidFrame;
};
