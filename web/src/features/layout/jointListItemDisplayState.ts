import type { JointLimitInfo } from "@/shared/lib/urdfBrowser";
import jointColors from "@/shared/joint_colors.json";
import { getJointColor } from "@/features/urdf/utils/jointColors";
import { RAD_TO_DEG } from "@/shared/lib/angleConversions";
import { JOINT_LIST_ITEM_PARAMS } from "@/features/layout/jointListItemParams";

type ResolveJointListItemDisplayStateArgs = {
  angleUnit: "rad" | "deg";
  availableJoints: readonly string[];
  colorJointNames?: readonly string[];
  effortLimit?: number | null;
  jointInfo?: JointLimitInfo;
  jointName: string;
  resolvedValue: number;
};

export type JointListItemDisplayState = {
  angleDisplay: string;
  angleDisplayValue: number;
  effortDisplay: string;
  isFixedJoint: boolean;
  jointTypeColor: string;
  squareColor: string;
  velocityDisplay: string;
};

const toFiniteNumberOrNull = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const formatJointMetricValue = (value: number | null | undefined): string => {
  const finiteValue = toFiniteNumberOrNull(value);
  return finiteValue === null
    ? JOINT_LIST_ITEM_PARAMS.missingMetricLabel
    : finiteValue.toFixed(JOINT_LIST_ITEM_PARAMS.metricDisplayPrecision);
};

const resolveJointTypeColor = (jointInfo?: JointLimitInfo): string => {
  if (jointInfo?.type === "fixed") {
    return jointColors.light_gray;
  }
  if (jointInfo?.type) {
    return (jointColors as Record<string, string>)[jointInfo.type] || jointColors.light_gray;
  }
  return jointColors.light_gray;
};

const resolveJointEditorColor = ({
  availableJoints,
  colorJointNames,
  isFixedJoint,
  jointName,
  jointTypeColor,
}: {
  availableJoints: readonly string[];
  colorJointNames?: readonly string[];
  isFixedJoint: boolean;
  jointName: string;
  jointTypeColor: string;
}): string => {
  if (isFixedJoint) {
    return jointColors.light_gray;
  }
  const colorReferenceJoints =
    colorJointNames && colorJointNames.length > 0 ? colorJointNames : availableJoints;
  return colorReferenceJoints.length > 0
    ? getJointColor(jointName, [...colorReferenceJoints])
    : jointTypeColor;
};

export const resolveJointListItemDisplayState = ({
  angleUnit,
  availableJoints,
  colorJointNames,
  effortLimit = null,
  jointInfo,
  jointName,
  resolvedValue,
}: ResolveJointListItemDisplayStateArgs): JointListItemDisplayState => {
  const isFixedJoint = jointInfo?.type === "fixed";
  const angleDisplayValue = angleUnit === "deg" ? resolvedValue * RAD_TO_DEG : resolvedValue;
  const angleDisplay = angleDisplayValue.toFixed(JOINT_LIST_ITEM_PARAMS.angleDisplayPrecision);
  const velocityDisplay = formatJointMetricValue(jointInfo?.velocity);
  const effortDisplay = formatJointMetricValue(effortLimit);
  const jointTypeColor = resolveJointTypeColor(jointInfo);
  const jointEditorColor = resolveJointEditorColor({
    availableJoints,
    colorJointNames,
    isFixedJoint,
    jointName,
    jointTypeColor,
  });

  return {
    angleDisplay,
    angleDisplayValue,
    effortDisplay,
    isFixedJoint,
    jointTypeColor,
    squareColor: isFixedJoint ? "#52525b" : jointEditorColor,
    velocityDisplay,
  };
};
