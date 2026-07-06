import type { URDFRobot } from "urdf-loader";
import { resolveJointScalarValue } from "@/features/viewer/viewer-helpers";
import { safeDecode } from "@/features/viewer/uri";

type ResolveApproachArmResetJointNamesArgs = {
  primaryIkEndEffectorLink: string | null | undefined;
  ikAllowedJointNamesByEe: ReadonlyMap<string, string[]>;
  robot: URDFRobot | null;
  wheelJointNames: ReadonlySet<string>;
};

export const resolveApproachArmResetJointNames = ({
  primaryIkEndEffectorLink,
  ikAllowedJointNamesByEe,
  robot,
  wheelJointNames,
}: ResolveApproachArmResetJointNamesArgs): string[] => {
  const eeLink = primaryIkEndEffectorLink?.trim() ?? "";
  if (!eeLink) return [];

  const decodedEeLink = safeDecode(eeLink);

  const ownedArmJointNames =
    ikAllowedJointNamesByEe.get(eeLink) ?? ikAllowedJointNamesByEe.get(decodedEeLink) ?? [];
  if (ownedArmJointNames.length > 0) {
    return ownedArmJointNames.filter((jointName) => !wheelJointNames.has(jointName));
  }

  return Object.keys(robot?.joints ?? {}).filter((jointName) => !wheelJointNames.has(jointName));
};

type ResolveApproachArmResetTargetValuesArgs = {
  jointNames: Iterable<string>;
  initialJointTargets: Readonly<Record<string, number>>;
};

export const resolveApproachArmResetTargetValues = ({
  jointNames,
  initialJointTargets,
}: ResolveApproachArmResetTargetValuesArgs): Record<string, number> => {
  const targetValues: Record<string, number> = {};
  for (const jointName of jointNames) {
    const targetValue = initialJointTargets[jointName];
    if (Number.isFinite(targetValue)) {
      targetValues[jointName] = targetValue;
    }
  }
  return targetValues;
};

type AreApproachArmResetTargetsSettledArgs = {
  robot: URDFRobot | null;
  targetJointValues: Readonly<Record<string, number>>;
  jointToleranceRad: number;
};

export const areApproachArmResetTargetsSettled = ({
  robot,
  targetJointValues,
  jointToleranceRad,
}: AreApproachArmResetTargetsSettledArgs): boolean => {
  const jointNames = Object.keys(targetJointValues);
  if (!robot || jointNames.length === 0) {
    return true;
  }
  for (const jointName of jointNames) {
    const targetValue = targetJointValues[jointName];
    const currentValue = resolveJointScalarValue(robot.joints?.[jointName]);
    if (!Number.isFinite(targetValue) || !Number.isFinite(currentValue)) {
      return false;
    }
    if (Math.abs((currentValue as number) - targetValue) > jointToleranceRad) {
      return false;
    }
  }
  return true;
};
