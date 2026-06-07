import { STUDIO_WHEEL_NAME_TOKEN_REGEX } from "@/features/viewer/studioWheelDriveHeuristics";
import {
  resolveOperatorTeleopSideFromTokens,
  tokenizeOperatorTeleopTargetName,
} from "@/features/teleop/profiles/operatorTeleopTargetSide";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import type { JointTopology } from "@/shared/store/useJointStore";

export type OperatorTeleopControlGroupKind = "arm" | "wheel_base" | "leg" | "unknown";

export type OperatorTeleopControlGroup = {
  id: string;
  kind: OperatorTeleopControlGroupKind;
  label: string;
  jointNames: string[];
  endEffectorJointNames: string[];
  teleopEnabled: boolean;
  disabledReason: string | null;
};

type ClassifiedJoint = {
  name: string;
  kind: OperatorTeleopControlGroupKind;
  side: "left" | "right" | "center";
  isEndEffector: boolean;
  sourceIndex: number;
  topologyBacked: boolean;
};

const OPERATOR_LEG_NAME_TOKENS = new Set([
  "leg",
  "hip",
  "knee",
  "ankle",
  "foot",
  "toe",
]);

const OPERATOR_TELEOP_GRIPPER_NAME_TOKENS = [
  "gripper",
  "finger",
  "claw",
  "jaw",
  "grip",
] as const;

const OPERATOR_TELEOP_DISTAL_GRIPPER_LINK_TOKENS = [
  "finger",
  "claw",
  "jaw",
] as const;

const OPERATOR_STRUCTURAL_JOINT_NAME_TOKENS = new Set([
  "world",
  "body",
  "base",
  "hand",
  "link0",
  "tcp",
  "mount",
  "mounting",
  "camera",
  "imu",
]);

const OPERATOR_ACTUATOR_NAME_TOKENS = new Set([
  "servo",
  "motor",
  "revolute",
  "continuous",
  "luff",
  "pitch",
  "prismatic",
  "rotation",
  "slide",
  "yaw",
]);

const tokenizeTopology = (
  jointName: string,
  topology?: JointTopology,
): string[] => [
  ...tokenizeOperatorTeleopTargetName(jointName),
  ...tokenizeOperatorTeleopTargetName(topology?.parentLinkName ?? ""),
  ...(topology?.childLinkNames.flatMap((name) =>
    tokenizeOperatorTeleopTargetName(name),
  ) ?? []),
  ...tokenizeOperatorTeleopTargetName(topology?.type ?? ""),
];

const hasAnyToken = (
  tokens: readonly string[],
  expectedTokens: readonly string[],
): boolean => expectedTokens.some((token) => tokens.includes(token));

const isMovableJoint = (jointName: string, jointLimits?: JointLimits): boolean => {
  const limit = jointLimits?.[jointName];
  if (!limit) {
    return true;
  }
  return limit.type !== "fixed";
};

const hasFixedTopology = (topology?: JointTopology): boolean =>
  topology?.type.trim().toLowerCase() === "fixed";

const hasDistalGripperChildLink = (topology?: JointTopology): boolean =>
  topology?.childLinkNames.some((childLinkName) =>
    hasAnyToken(
      tokenizeOperatorTeleopTargetName(childLinkName),
      OPERATOR_TELEOP_DISTAL_GRIPPER_LINK_TOKENS,
    ),
  ) ?? false;

const isGripperJoint = (
  jointTokens: readonly string[],
  topology?: JointTopology,
): boolean =>
  hasAnyToken(jointTokens, OPERATOR_TELEOP_GRIPPER_NAME_TOKENS) ||
  hasDistalGripperChildLink(topology);

const isArmJoint = (tokens: readonly string[]): boolean =>
  hasAnyToken(tokens, [
    "arm",
    "openarm",
    "shoulder",
    "elbow",
    "forearm",
    "upperarm",
    "wrist",
    "tool",
    "end",
    "rotation",
    "pitch",
  ]);

const isWheelJoint = (jointName: string, tokens: readonly string[]): boolean =>
  STUDIO_WHEEL_NAME_TOKEN_REGEX.test(jointName) ||
  hasAnyToken(tokens, ["wheel", "tire", "rim", "caster", "omni"]);

const isLegJoint = (tokens: readonly string[]): boolean =>
  tokens.some((token) => OPERATOR_LEG_NAME_TOKENS.has(token));

const isStructuralJoint = (tokens: readonly string[]): boolean =>
  tokens.some((token) => OPERATOR_STRUCTURAL_JOINT_NAME_TOKENS.has(token));

const isActuatorLikeJoint = (
  jointName: string,
  tokens: readonly string[],
  jointLimits?: JointLimits,
): boolean => {
  const jointType = jointLimits?.[jointName]?.type;
  return (
    jointType === "continuous" ||
    jointType === "revolute" ||
    jointType === "prismatic" ||
    tokens.some((token) => OPERATOR_ACTUATOR_NAME_TOKENS.has(token))
  );
};

const classifyJoint = (
  jointName: string,
  sourceIndex: number,
  jointLimits?: JointLimits,
  jointTopologyByName?: Record<string, JointTopology>,
): ClassifiedJoint | null => {
  if (!jointName.trim() || !isMovableJoint(jointName, jointLimits)) {
    return null;
  }

  const jointTokens = tokenizeOperatorTeleopTargetName(jointName);
  const topology = jointTopologyByName?.[jointName];
  if (hasFixedTopology(topology)) {
    return null;
  }
  const tokens = tokenizeTopology(jointName, topology);
  const isEndEffector = isGripperJoint(jointTokens, topology);
  const isActuator = isActuatorLikeJoint(jointName, tokens, jointLimits);
  if (isWheelJoint(jointName, tokens)) {
    return {
      name: jointName,
      kind: "wheel_base",
      side: "center",
      isEndEffector,
      sourceIndex,
      topologyBacked: Boolean(topology),
    };
  }
  if (isStructuralJoint(jointTokens) && !isEndEffector && !isActuator) {
    return null;
  }
  if (isLegJoint(tokens)) {
    return {
      name: jointName,
      kind: "leg",
      side: resolveOperatorTeleopSideFromTokens(tokens),
      isEndEffector,
      sourceIndex,
      topologyBacked: Boolean(topology),
    };
  }
  if (isEndEffector || isArmJoint(tokens)) {
    return {
      name: jointName,
      kind: "arm",
      side: resolveOperatorTeleopSideFromTokens(tokens),
      isEndEffector,
      sourceIndex,
      topologyBacked: Boolean(topology),
    };
  }
  return {
    name: jointName,
    kind: isActuator ? "arm" : "unknown",
    side: resolveOperatorTeleopSideFromTokens(tokens),
    isEndEffector,
    sourceIndex,
    topologyBacked: Boolean(topology),
  };
};

const toSortedUniqueJointNames = (jointNames: string[]): string[] =>
  Array.from(new Set(jointNames.filter((name) => name.trim()))).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
  );

const toUniqueJointNamesBySourceOrder = (joints: ClassifiedJoint[]): string[] =>
  Array.from(
    new Map(
      [...joints]
        .sort((left, right) => left.sourceIndex - right.sourceIndex)
        .map((joint) => [joint.name, joint.name]),
    ).values(),
  );

const createArmGroup = (
  id: string,
  label: string,
  joints: ClassifiedJoint[],
): OperatorTeleopControlGroup | null => {
  const jointNames = joints.some((joint) => joint.topologyBacked)
    ? toUniqueJointNamesBySourceOrder(joints)
    : toSortedUniqueJointNames(joints.map((joint) => joint.name));
  if (jointNames.length === 0) return null;

  const endEffectorJoints = joints.filter((joint) => joint.isEndEffector);
  const endEffectorJointNames = joints.some((joint) => joint.topologyBacked)
    ? toUniqueJointNamesBySourceOrder(endEffectorJoints)
    : toSortedUniqueJointNames(endEffectorJoints.map((joint) => joint.name));
  const hasArmJoint = joints.some((joint) => !joint.isEndEffector);
  return {
    id,
    kind: "arm",
    label,
    jointNames,
    endEffectorJointNames,
    teleopEnabled: hasArmJoint,
    disabledReason: hasArmJoint
      ? null
      : "Gripper-only targets need an arm joint before teleop is enabled.",
  };
};

const createDisabledGroup = (
  id: string,
  kind: Exclude<OperatorTeleopControlGroupKind, "arm">,
  label: string,
  jointNames: string[],
  disabledReason: string,
): OperatorTeleopControlGroup | null => {
  const uniqueJointNames = toSortedUniqueJointNames(jointNames);
  if (uniqueJointNames.length === 0) return null;
  return {
    id,
    kind,
    label,
    jointNames: uniqueJointNames,
    endEffectorJointNames: [],
    teleopEnabled: false,
    disabledReason,
  };
};

const splitArmGroups = (armJoints: ClassifiedJoint[]): OperatorTeleopControlGroup[] => {
  const left = armJoints.filter((joint) => joint.side === "left");
  const right = armJoints.filter((joint) => joint.side === "right");
  const center = armJoints.filter((joint) => joint.side === "center");
  const splitBySide = left.length > 0 && right.length > 0;
  const groups: OperatorTeleopControlGroup[] = [];

  if (splitBySide) {
    const leftGroup = createArmGroup("arm.left", "Left arm", [...left, ...center]);
    const rightGroup = createArmGroup("arm.right", "Right arm", right);
    if (leftGroup) groups.push(leftGroup);
    if (rightGroup) groups.push(rightGroup);
    return groups;
  }

  const primaryGroup = createArmGroup("arm.primary", "Arm", armJoints);
  return primaryGroup ? [primaryGroup] : [];
};

export const buildOperatorTeleopControlGroups = ({
  jointNames,
  jointLimits,
  jointTopologyByName,
}: {
  jointNames: readonly string[];
  jointLimits?: JointLimits;
  jointTopologyByName?: Record<string, JointTopology>;
}): OperatorTeleopControlGroup[] => {
  const classifiedJoints = jointNames
    .map((jointName, index) =>
      classifyJoint(jointName, index, jointLimits, jointTopologyByName),
    )
    .filter((joint): joint is ClassifiedJoint => joint !== null);

  const armJoints = classifiedJoints.filter((joint) => joint.kind === "arm");
  const wheelJointNames = classifiedJoints
    .filter((joint) => joint.kind === "wheel_base")
    .map((joint) => joint.name);
  const legJointNames = classifiedJoints
    .filter((joint) => joint.kind === "leg")
    .map((joint) => joint.name);
  return [
    ...splitArmGroups(armJoints),
    createDisabledGroup(
      "wheel_base.primary",
      "wheel_base",
      "Wheels",
      wheelJointNames,
      "Wheel teleop is not enabled yet.",
    ),
    createDisabledGroup(
      "leg.primary",
      "leg",
      "Legs",
      legJointNames,
      "Leg teleop is not enabled yet.",
    ),
  ].filter((group): group is OperatorTeleopControlGroup => group !== null);
};
