import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";

import { normalizeDirection } from "@/shared/lib/axisFrame";
import {
  ROVER_APPROACH_NAVIGATION_CONFIG,
  type RoverApproachRobotFootprint,
} from "@/features/locomotion/approach";
import type { StudioWheelDriveModel } from "@/features/viewer/studioWheelDriveModel";
import {
  resolveProjectedRobotSpanMeters,
  resolveSafeMotionDimension,
} from "@/features/viewer/studioWheelDriveModel";

export const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
};

export const hexToThreeJsHex = (hex: string): number =>
  parseInt(hex.replace("#", ""), 16);

export const isFinitePositiveMotionDimension = (
  value: number | null | undefined
): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > Number.EPSILON;

export const resolveRoverApproachRobotFootprint = ({
  robot,
  wheelModel,
  upAxisWorld,
  forwardWorld,
}: {
  robot: URDFRobot;
  wheelModel: StudioWheelDriveModel;
  upAxisWorld: THREE.Vector3;
  forwardWorld: THREE.Vector3;
}): RoverApproachRobotFootprint => {
  const safeTrackWidthM = resolveSafeMotionDimension(wheelModel.trackWidth);
  const lateralWorld = new THREE.Vector3().crossVectors(upAxisWorld, forwardWorld);
  const normalizedLateralWorld = normalizeDirection(
    lateralWorld,
    new THREE.Vector3(0, 1, 0)
  );
  const projectedLengthM =
    resolveProjectedRobotSpanMeters(robot, forwardWorld) ??
    safeTrackWidthM *
      ROVER_APPROACH_NAVIGATION_CONFIG.robotFootprintLengthFallbackTrackWidthRatio;
  const projectedWidthM = Math.max(
    safeTrackWidthM,
    resolveProjectedRobotSpanMeters(robot, normalizedLateralWorld) ?? 0
  );
  return {
    halfLengthM: projectedLengthM * 0.5,
    halfWidthM: projectedWidthM * 0.5,
  };
};

export const areSortedStringListsEqual = (
  lhs: readonly string[],
  rhs: readonly string[]
): boolean => lhs.length === rhs.length && lhs.every((value, index) => value === rhs[index]);
