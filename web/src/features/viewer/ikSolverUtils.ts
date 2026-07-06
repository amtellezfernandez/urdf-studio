import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import type { CreatedObject } from "@/features/objects";
import type { IkOrientationSetting } from "@/features/ik/useIkParamsStore";
import type { OrientationMode } from "@/features/ik/registry";
import { safeDecodeEndEffectorLink } from "@/features/viewer/ikEndEffectorLink";

export { safeDecodeEndEffectorLink } from "@/features/viewer/ikEndEffectorLink";

const IK_INPUT_SOURCES = {
  apply: "ik_apply",
  drag: "ik_drag",
} as const;

export const IK_APPLY_INPUT_SOURCE = IK_INPUT_SOURCES.apply;
export const IK_DRAG_INPUT_SOURCE = IK_INPUT_SOURCES.drag;

export type IkAppliedMetadata = {
  inputSource: typeof IK_APPLY_INPUT_SOURCE | typeof IK_DRAG_INPUT_SOURCE;
};

export type IkObjectPreSolveProgress = {
  phase?: "idle" | "rotate" | "translate" | "done";
  distanceToTargetM?: number | null;
  yawErrorDeg?: number | null;
};

export type IkObjectPreSolveResult = {
  status: "completed" | "skipped" | "timeout" | "cancelled" | "failed";
  reason?: string;
  durationMs?: number;
  finalDistanceToTargetM?: number | null;
  finalYawErrorDeg?: number | null;
};

export type IkObjectPreSolveContext = {
  object: CreatedObject;
  targetPositionWorld: [number, number, number];
  isOrbitTarget: boolean;
  targetKind?: "object-center" | "surface-point";
  isStaleSolve: () => boolean;
  reportProgress: (progress: IkObjectPreSolveProgress) => void;
};

export const resolveEffectorWorldPose = (
  robot: URDFRobot,
  endEffectorLink: string
): { position: THREE.Vector3; quaternion: THREE.Quaternion } => {
  const robotAny = robot as URDFRobot & {
    links?: Record<string, THREE.Object3D>;
    getObjectByName?: (name: string) => THREE.Object3D | undefined;
  };
  const effObj =
    robotAny.links?.[endEffectorLink] ??
    robotAny.getObjectByName?.(endEffectorLink) ??
    robotAny.getObjectByName?.(safeDecodeEndEffectorLink(endEffectorLink));
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  if (!effObj) {
    quaternion.set(0, 0, 0, 1);
    return { position, quaternion };
  }
  effObj.updateMatrixWorld(true);
  const tmpScale = new THREE.Vector3();
  effObj.matrixWorld.decompose(position, quaternion, tmpScale);
  return { position, quaternion };
};

const isIkObjectPreSolveResult = (
  value: unknown
): value is IkObjectPreSolveResult =>
  Boolean(
    value &&
      typeof value === "object" &&
      "status" in (value as Record<string, unknown>)
  );

export const normalizeIkObjectPreSolveResult = (
  value: IkObjectPreSolveResult | void
): IkObjectPreSolveResult =>
  isIkObjectPreSolveResult(value)
    ? value
    : {
        status: "skipped",
        reason: "not-required",
      };

export const resolveOrientationMode = (
  setting: IkOrientationSetting,
  fallback: OrientationMode
): OrientationMode => (setting === "auto" ? fallback : setting);

export const deriveComAlignedQuaternion = (
  effWorldPos: THREE.Vector3,
  effWorldQuat: THREE.Quaternion,
  targetWorldPos: THREE.Vector3,
  preferredAxisLocal?: [number, number, number]
): THREE.Quaternion => {
  const toTarget = targetWorldPos.clone().sub(effWorldPos);
  if (toTarget.lengthSq() < 1e-10) {
    return effWorldQuat.clone();
  }
  toTarget.normalize();

  const bestAxis = preferredAxisLocal
    ? new THREE.Vector3(
        preferredAxisLocal[0],
        preferredAxisLocal[1],
        preferredAxisLocal[2]
      )
    : new THREE.Vector3(1, 0, 0);
  const currentApproach = bestAxis.applyQuaternion(effWorldQuat).normalize();
  const bestDot = currentApproach.dot(toTarget);
  if (!Number.isFinite(bestDot)) {
    return effWorldQuat.clone();
  }

  if (bestDot >= 0.9995) {
    return effWorldQuat.clone();
  }

  const alignRotation = new THREE.Quaternion().setFromUnitVectors(
    currentApproach,
    toTarget
  );
  return alignRotation.multiply(effWorldQuat).normalize();
};

export const resolveApproachAxisForEe = (
  effWorldPos: THREE.Vector3,
  effWorldQuat: THREE.Quaternion,
  targetWorldPos: THREE.Vector3
): [number, number, number] => {
  const toTarget = targetWorldPos.clone().sub(effWorldPos);
  if (toTarget.lengthSq() < 1e-10) {
    return [1, 0, 0];
  }
  toTarget.normalize();

  const axisCandidates: Array<[number, number, number]> = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let best = axisCandidates[0];
  let bestDot = -Infinity;
  const axisWorld = new THREE.Vector3();
  for (const axis of axisCandidates) {
    axisWorld
      .set(axis[0], axis[1], axis[2])
      .applyQuaternion(effWorldQuat)
      .normalize();
    const dot = axisWorld.dot(toTarget);
    if (dot > bestDot) {
      bestDot = dot;
      best = axis;
    }
  }
  return best;
};

export const resolveIkRearTransitWorldTarget = ({
  baseWorldPosition,
  effectorWorldPosition,
  targetWorldPosition,
}: {
  baseWorldPosition: THREE.Vector3;
  effectorWorldPosition: THREE.Vector3;
  targetWorldPosition: THREE.Vector3;
}): [number, number, number] => {
  const radial = new THREE.Vector3(
    targetWorldPosition.x - baseWorldPosition.x,
    targetWorldPosition.y - baseWorldPosition.y,
    0
  );
  if (radial.lengthSq() < 1e-10) {
    radial.set(
      effectorWorldPosition.x - baseWorldPosition.x,
      effectorWorldPosition.y - baseWorldPosition.y,
      0
    );
  }
  if (radial.lengthSq() < 1e-10) {
    radial.set(1, 0, 0);
  }
  radial.normalize();

  const baseToTarget = Math.hypot(
    targetWorldPosition.x - baseWorldPosition.x,
    targetWorldPosition.y - baseWorldPosition.y
  );
  const transitRadius = Math.min(0.3, Math.max(0.12, baseToTarget * 0.42));
  const transitHeight =
    Math.max(
      effectorWorldPosition.z,
      targetWorldPosition.z,
      baseWorldPosition.z + 0.12
    ) + Math.min(0.14, Math.max(0.06, baseToTarget * 0.18));

  return [
    baseWorldPosition.x + radial.x * transitRadius,
    baseWorldPosition.y + radial.y * transitRadius,
    transitHeight,
  ];
};
