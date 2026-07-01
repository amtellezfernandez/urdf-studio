import type { JointLimits } from "@/shared/lib/urdfBrowser";
import { getJointLimits } from "@/shared/lib/urdfBrowser";
import type { CreatedObject } from "@/features/objects";

const GRIPPER_JOINT_TOKENS = new Set([
  "gripper",
  "jaw",
  "finger",
  "claw",
  "pincer",
  "pincher",
  "pinch",
]);

const MOVABLE_GRIPPER_JOINT_TYPES = new Set([
  "continuous",
  "prismatic",
  "revolute",
]);

const NON_GRASPABLE_OBJECT_SOURCES = new Set<CreatedObject["source"]>([
  "runtime-restricted-area",
  "runtime-trajectory",
]);

export const EE_OBJECT_GRASP_PARAMS = {
  graspClosedFraction: 0.38,
  releaseOpenFraction: 0.46,
  fallbackGraspMaxValue: 0.55,
  fallbackReleaseMinValue: 0.7,
  positionUpdateEpsilonSq: 1e-8,
} as const;

export type GripperGraspState = "engaged" | "released" | "unknown";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const splitJointNameTokens = (jointName: string): string[] =>
  jointName
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const scoreGripperJointName = (jointName: string): number => {
  const normalized = jointName.trim().toLowerCase();
  const tokens = splitJointNameTokens(normalized);
  if (normalized === "gripper") return 100;
  if (tokens.includes("gripper")) return 90;
  if (tokens.includes("jaw")) return 80;
  if (tokens.includes("finger")) return 70;
  if (tokens.includes("claw")) return 65;
  if (tokens.includes("pincer") || tokens.includes("pincher")) return 60;
  if (tokens.includes("pinch")) return 55;
  return tokens.some((token) => GRIPPER_JOINT_TOKENS.has(token)) ? 50 : 0;
};

const isMovableJointLimitEntry = (
  jointLimits: JointLimits | undefined,
  jointName: string
): boolean => {
  const type = jointLimits?.[jointName]?.type;
  if (!type) return true;
  return MOVABLE_GRIPPER_JOINT_TYPES.has(String(type).toLowerCase());
};

export const resolveGripperJointName = ({
  jointValues,
  jointLimits,
}: {
  jointValues: Readonly<Record<string, number>>;
  jointLimits?: JointLimits;
}): string | null => {
  const candidateNames = new Set([
    ...Object.keys(jointLimits ?? {}),
    ...Object.keys(jointValues),
  ]);
  const candidates = Array.from(candidateNames)
    .map((jointName) => ({
      jointName,
      score: scoreGripperJointName(jointName),
    }))
    .filter(
      ({ jointName, score }) =>
        score > 0 &&
        Number.isFinite(jointValues[jointName]) &&
        isMovableJointLimitEntry(jointLimits, jointName)
    )
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.jointName.localeCompare(right.jointName);
    });

  return candidates[0]?.jointName ?? null;
};

export const resolveGripperGraspState = ({
  jointValues,
  jointLimits,
  holding,
}: {
  jointValues: Readonly<Record<string, number>>;
  jointLimits?: JointLimits;
  holding: boolean;
}): GripperGraspState => {
  const gripperJointName = resolveGripperJointName({ jointValues, jointLimits });
  if (!gripperJointName) return "unknown";

  const value = jointValues[gripperJointName];
  if (!Number.isFinite(value)) return "unknown";

  const limits = getJointLimits(jointLimits, gripperJointName);
  const range = limits.upper - limits.lower;
  if (Number.isFinite(limits.lower) && Number.isFinite(limits.upper) && range > 1e-6) {
    const openFraction = clamp01((value - limits.lower) / range);
    const threshold = holding
      ? EE_OBJECT_GRASP_PARAMS.releaseOpenFraction
      : EE_OBJECT_GRASP_PARAMS.graspClosedFraction;
    return openFraction <= threshold ? "engaged" : "released";
  }

  const threshold = holding
    ? EE_OBJECT_GRASP_PARAMS.fallbackReleaseMinValue
    : EE_OBJECT_GRASP_PARAMS.fallbackGraspMaxValue;
  return value <= threshold ? "engaged" : "released";
};

export const isGraspableWorldObject = (object: CreatedObject): boolean =>
  object.isHidden !== true &&
  object.type !== "point" &&
  !NON_GRASPABLE_OBJECT_SOURCES.has(object.source) &&
  object.size.x > 0 &&
  object.size.y > 0 &&
  object.size.z > 0;
