import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import { IK_ARM_REACH_CONFIG } from "@/features/viewer/config";
import { resolveReachRadiusFromAnalysis } from "@/features/viewer/drag-runtime";

type RobotLike = URDFRobot & {
  links?: Record<string, THREE.Object3D>;
  getObjectByName?: (name: string) => THREE.Object3D | undefined;
};

export type ArmReachEnvelope = {
  baseLinkName: string | null;
  basePositionWorld: THREE.Vector3;
  radiusMeters: number;
};

type ResolveArmReachEnvelopeParams = {
  robot: URDFRobot | null;
  urdfAnalysis: UrdfAnalysis | null;
  endEffectorLink: string | null;
  maxLinkTraversal: number;
};

const resolveBaseObject = (
  robot: RobotLike,
  baseLinkName: string | null
): THREE.Object3D => {
  if (!baseLinkName) return robot;
  return robot.links?.[baseLinkName] ?? robot.getObjectByName?.(baseLinkName) ?? robot;
};

const TMP_CLAMP_DELTA = new THREE.Vector3();

export const resolveArmReachEnvelope = ({
  robot,
  urdfAnalysis,
  endEffectorLink,
  maxLinkTraversal,
}: ResolveArmReachEnvelopeParams): ArmReachEnvelope | null => {
  const eeLink = endEffectorLink?.trim() ?? "";
  if (!robot || !urdfAnalysis || !eeLink) return null;

  const reach = resolveReachRadiusFromAnalysis({
    urdfAnalysis,
    endEffectorLink: eeLink,
    robot,
    maxLinkTraversal,
    reachMargin: IK_ARM_REACH_CONFIG.margin,
    minReachMargin: IK_ARM_REACH_CONFIG.minMargin,
    reachSlackMeters: IK_ARM_REACH_CONFIG.slackMeters,
    dynamicHeadroomMeters: IK_ARM_REACH_CONFIG.dynamicHeadroomMeters,
  });
  if (!Number.isFinite(reach.reachRadius) || (reach.reachRadius ?? 0) <= 0) {
    return null;
  }

  const robotAny = robot as RobotLike;
  const baseObject = resolveBaseObject(robotAny, reach.baseLinkName);
  const basePositionWorld = new THREE.Vector3();
  baseObject.updateMatrixWorld(true);
  baseObject.getWorldPosition(basePositionWorld);
  return {
    baseLinkName: reach.baseLinkName,
    basePositionWorld,
    radiusMeters: reach.reachRadius as number,
  };
};

export const clampWorldTargetToArmReach = (
  targetWorld: THREE.Vector3,
  envelope: ArmReachEnvelope | null,
  out: THREE.Vector3
): { targetWorld: THREE.Vector3; clamped: boolean } => {
  if (!envelope) {
    return { targetWorld: out.copy(targetWorld), clamped: false };
  }
  TMP_CLAMP_DELTA.copy(targetWorld).sub(envelope.basePositionWorld);
  const distance = TMP_CLAMP_DELTA.length();
  if (
    !Number.isFinite(distance) ||
    distance <= envelope.radiusMeters + IK_ARM_REACH_CONFIG.clampEpsilonMeters
  ) {
    return { targetWorld: out.copy(targetWorld), clamped: false };
  }
  if (distance <= IK_ARM_REACH_CONFIG.clampEpsilonMeters) {
    return { targetWorld: out.copy(targetWorld), clamped: false };
  }
  TMP_CLAMP_DELTA.setLength(envelope.radiusMeters);
  return {
    targetWorld: out.copy(envelope.basePositionWorld).add(TMP_CLAMP_DELTA),
    clamped: true,
  };
};
