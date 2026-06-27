import type { OperatorTeleopControlGroup } from "@/features/teleop/profiles/operatorTeleopControlGroups";
import { OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE } from "@/features/teleop/params/operatorTeleopParams";
import type {
  OperatorLeaderControlPart,
  OperatorLeaderDevice,
  OperatorLeaderReleaseRequest,
} from "@/features/teleop/transport/operatorHelperApi";
import { formatOperatorCalibrationModifiedLine } from "@/features/teleop/transport/operatorCalibrationFileTimestamp";
import type {
  OperatorLeaderAssignment,
  OperatorLeaderAssignmentSide,
} from "@/features/teleop/transport/operatorLeaderAssignments";
import {
  resolveOperatorLeaderTargetJointNames,
  scoreOperatorLeaderControlPartForTarget,
} from "@/features/teleop/transport/operatorLeaderTelemetry";

const OPENARM_NUMBERED_JOINT_PATTERN = /(?:^| )joint\s*(\d+)(?: |$)/;
const NON_WORD_TOKEN_PATTERN = /[^a-z0-9]+/g;
const CAMEL_CASE_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/g;
const WHITESPACE_PATTERN = /\s+/g;
const LEADER_ROLE_TOKEN_PATTERN = /(?:^|[\s_-])leader(?:[\s_-]|$)/i;
const FOLLOWER_ROLE_TOKEN_PATTERN = /(?:^|[\s_-])follower(?:[\s_-]|$)/i;

const ARM_JOINT_ORDER_RANK = {
  shoulderPan: 1,
  shoulderLift: 2,
  elbow: 3,
  wristFlex: 4,
  wristRoll: 5,
  fallback: 50,
  endEffector: 100,
} as const;

const LEADER_CONTROL_GROUP_IDS = {
  singleArmPrimary: "arm.primary",
  leftArm: "arm.left",
  rightArm: "arm.right",
} as const;

const LEADER_CONTROL_PART_ROLE_AFFINITY = {
  preferred: 1,
  neutral: 0,
  fallback: -1,
} as const;
const LEROBOT_CALIBRATION_CATEGORY_LABELS: Record<string, string> = {
  teleoperators: "teleoperator",
  robots: "robot/follower",
};
const LEADER_MOTOR_PROBE_TEXT = {
  failedDetail: "Motor probe failed",
  blockedReason:
    "Motor probe failed. Disconnect other use of this port, then Rescan.",
} as const;

export type OperatorLeaderTargetCompatibility = {
  compatible: boolean;
  reason: string;
};

export type OperatorLeaderTargetOption = {
  group: OperatorTeleopControlGroup;
  side: OperatorLeaderAssignmentSide;
  compatibility: OperatorLeaderTargetCompatibility;
};

export type OperatorLeaderTargetSelection = {
  targetOptions: OperatorLeaderTargetOption[];
  selectableTargetOptions: OperatorLeaderTargetOption[];
  connectedTargetOption: OperatorLeaderTargetOption | null;
  pendingTargetOption: OperatorLeaderTargetOption | null;
  selectedTargetOption: OperatorLeaderTargetOption | null;
  selectedCompatibility: OperatorLeaderTargetCompatibility | null;
};

const hasExplicitLeaderCalibration = (
  part: OperatorLeaderControlPart,
): boolean =>
  Boolean(part.calibrationCategory && part.calibrationProfile && part.calibrationId);

const requiresExplicitLeaderCalibration = (
  leader: OperatorLeaderDevice,
  part: OperatorLeaderControlPart,
): boolean => leader.motorBus === "feetech" && part.kind === "arm";

const formatLeaderCalibrationLabel = (
  part: OperatorLeaderControlPart,
): string | null => {
  if (!hasExplicitLeaderCalibration(part)) return null;
  const categoryLabel =
    LEROBOT_CALIBRATION_CATEGORY_LABELS[part.calibrationCategory ?? ""] ??
    part.calibrationCategory;
  const calibrationPath = [
    part.calibrationProfile,
    part.calibrationId,
    part.calibrationGroup,
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    "LeRobot",
    categoryLabel,
    "calibration:",
    calibrationPath,
  ]
    .filter(Boolean)
    .join(" ");
};

export const formatLeaderControlPartChoiceLabel = (
  part: OperatorLeaderControlPart,
): string => {
  if (hasExplicitLeaderCalibration(part)) {
    const categoryLabel =
      LEROBOT_CALIBRATION_CATEGORY_LABELS[part.calibrationCategory ?? ""] ??
      part.calibrationCategory ??
      "calibration";
    const calibrationPath = [
      part.calibrationProfile,
      part.calibrationId,
      part.calibrationGroup,
    ]
      .filter(Boolean)
      .join(" · ");
    return [categoryLabel, calibrationPath].filter(Boolean).join(": ");
  }
  const label = part.label.trim();
  return label ? `${label} (${part.actuatorCount} actuators)` : `${part.actuatorCount} actuators`;
};

const formatLeaderConfiguredPortLabel = (
  part: OperatorLeaderControlPart,
): string | null => {
  switch (part.configuredPortStatus) {
    case "matched":
      return "LeRobot port matches this controller";
    case "stale":
      return "LeRobot configured port is missing";
    case "unmatched":
      return "LeRobot port differs from this controller";
    case "none":
      return null;
  }
};

export const buildLeaderHardwareDetailLines = (
  leader: OperatorLeaderDevice,
  part: OperatorLeaderControlPart | null,
): string[] => {
  if (part) {
    const lines = ["Arm device"];
    const calibrationLabel = formatLeaderCalibrationLabel(part);
    if (calibrationLabel) {
      lines.push(calibrationLabel);
      const modifiedLine = formatOperatorCalibrationModifiedLine(
        part.calibrationMtimeNs,
      );
      if (modifiedLine) {
        lines.push(modifiedLine);
      }
      const configuredPortLabel = formatLeaderConfiguredPortLabel(part);
      if (configuredPortLabel) {
        lines.push(configuredPortLabel);
      }
    } else if (requiresExplicitLeaderCalibration(leader, part)) {
      lines.push("Calibration required");
    } else if (part.label.trim()) {
      lines.push(part.label.trim());
    }
    lines.push(`${part.actuatorCount} actuators`);
    return lines;
  }
  if (leader.motorBus === "feetech" && leader.motorCount > 0) {
    return ["Feetech device", `${leader.motorCount} motors`];
  }
  if (leader.motorProbeError) {
    return ["Serial device", LEADER_MOTOR_PROBE_TEXT.failedDetail];
  }
  return ["Serial device"];
};

export const buildLeaderCalibrationSetupLines = (
  request: OperatorLeaderReleaseRequest | null,
): string[] => {
  const profile = request?.calibrationProfile?.trim();
  if (!profile) return [];
  if (profile === OPERATOR_OPENARM_MINI_TELEOPERATOR_TYPE) {
    const hasLeftPort = Boolean(request.portLeft?.trim());
    const hasRightPort = Boolean(request.portRight?.trim());
    if (hasLeftPort && hasRightPort) {
      const calibrationId = request.calibrationId?.trim() ?? "";
      const baseCalibrationId = calibrationId.replace(/_(?:left|right)$/u, "");
      return [
        "LeRobot setup: bi_openarm_mini (left + right)",
        ...(baseCalibrationId
          ? [
              `Writes files: ${baseCalibrationId}_left.json + ${baseCalibrationId}_right.json`,
            ]
          : ["Writes left + right calibration files"]),
      ];
    }
    const side = request.calibrationGroup?.trim();
    return [
      side === "left" || side === "right"
        ? `LeRobot setup: openarm_mini (${side})`
        : "LeRobot setup: openarm_mini",
    ];
  }
  return [`LeRobot setup: ${profile}`];
};

export const buildLeaderDeviceRoleKeys = (
  leader: OperatorLeaderDevice,
): string[] => [
  ...new Set(
    [
      leader.identityKey,
      leader.path,
      leader.devicePath,
      ...leader.controlParts.map((part) => part.configuredPort),
    ]
      .map((deviceKey) => deviceKey?.trim() ?? "")
      .filter(Boolean),
  ),
];

const scoreLeaderControlPartRoleAffinity = (
  part: OperatorLeaderControlPart,
): number => {
  if (part.calibrationCategory === "teleoperators") {
    return LEADER_CONTROL_PART_ROLE_AFFINITY.preferred;
  }
  if (part.calibrationCategory === "robots") {
    return LEADER_CONTROL_PART_ROLE_AFFINITY.fallback;
  }
  const roleText = [
    part.label,
    part.calibrationProfile,
    part.calibrationId,
  ]
    .filter(Boolean)
    .join(" ");
  if (LEADER_ROLE_TOKEN_PATTERN.test(roleText)) {
    return LEADER_CONTROL_PART_ROLE_AFFINITY.preferred;
  }
  if (FOLLOWER_ROLE_TOKEN_PATTERN.test(roleText)) {
    return LEADER_CONTROL_PART_ROLE_AFFINITY.fallback;
  }
  return LEADER_CONTROL_PART_ROLE_AFFINITY.neutral;
};

const normalizeTeleopJointName = (jointName: string): string =>
  jointName
    .trim()
    .replace(CAMEL_CASE_BOUNDARY_PATTERN, "$1 $2")
    .toLowerCase()
    .replace(NON_WORD_TOKEN_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();

const resolveArmJointOrderRank = (jointName: string): number => {
  const normalized = normalizeTeleopJointName(jointName);
  const tokens = normalized.split(" ").filter(Boolean);
  const openArmJointMatch = OPENARM_NUMBERED_JOINT_PATTERN.exec(normalized);
  if (openArmJointMatch) {
    return Number(openArmJointMatch[1]);
  }
  if (tokens.includes("shoulder") && (tokens.includes("pan") || tokens.includes("yaw"))) {
    return ARM_JOINT_ORDER_RANK.shoulderPan;
  }
  if (
    tokens.includes("shoulder") &&
    (tokens.includes("lift") || tokens.includes("pitch"))
  ) {
    return ARM_JOINT_ORDER_RANK.shoulderLift;
  }
  if (tokens.includes("elbow")) {
    return ARM_JOINT_ORDER_RANK.elbow;
  }
  if (tokens.includes("wrist") && (tokens.includes("flex") || tokens.includes("pitch"))) {
    return ARM_JOINT_ORDER_RANK.wristFlex;
  }
  if (tokens.includes("wrist") && tokens.includes("roll")) {
    return ARM_JOINT_ORDER_RANK.wristRoll;
  }
  if (
    tokens.includes("gripper") ||
    tokens.includes("finger") ||
    tokens.includes("claw") ||
    tokens.includes("jaw")
  ) {
    return ARM_JOINT_ORDER_RANK.endEffector;
  }
  return ARM_JOINT_ORDER_RANK.fallback;
};

const sortTeleopActuatorJointNames = (
  jointNames: readonly string[],
): string[] =>
  [...jointNames].sort(
    (leftName, rightName) =>
      resolveArmJointOrderRank(leftName) - resolveArmJointOrderRank(rightName) ||
      leftName.localeCompare(rightName, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );

export const resolveTeleopTargetActuatorJointNames = (
  group: OperatorTeleopControlGroup,
): string[] => {
  const endEffectorJointNames = new Set(group.endEffectorJointNames);
  const armJointNames = group.jointNames.filter(
    (jointName) => !endEffectorJointNames.has(jointName),
  );
  const sortedArmJointNames = sortTeleopActuatorJointNames(armJointNames);
  const primaryEndEffectorJointName =
    sortTeleopActuatorJointNames(group.endEffectorJointNames)[0] ?? null;
  return primaryEndEffectorJointName
    ? [...sortedArmJointNames, primaryEndEffectorJointName]
    : sortedArmJointNames;
};

const resolveTeleopTargetActuatorCount = (
  group: OperatorTeleopControlGroup,
): number => resolveTeleopTargetActuatorJointNames(group).length;

const canUsePartialLeaderMapping = (
  group: OperatorTeleopControlGroup,
): boolean => group.id === LEADER_CONTROL_GROUP_IDS.singleArmPrimary;

export const resolveLeaderMappedTargetJointNames = (
  group: OperatorTeleopControlGroup,
  controlPart: Pick<
    OperatorLeaderControlPart,
    "actuatorCount" | "jointNames"
  > | null,
): string[] => {
  const targetJointNames = resolveTeleopTargetActuatorJointNames(group);
  if (!controlPart || controlPart.actuatorCount <= 0) {
    return targetJointNames;
  }
  const sourceJointNames = controlPart.jointNames.slice(0, controlPart.actuatorCount);
  return resolveOperatorLeaderTargetJointNames(
    sourceJointNames,
    targetJointNames,
    controlPart.actuatorCount,
  );
};

const compareLeaderControlPartsForTarget = (
  group: OperatorTeleopControlGroup,
  left: OperatorLeaderControlPart,
  right: OperatorLeaderControlPart,
): number => {
  const requiredActuatorCount = resolveTeleopTargetActuatorCount(group);
  const targetJointNames = resolveTeleopTargetActuatorJointNames(group);
  const leftCalibrated = hasExplicitLeaderCalibration(left);
  const rightCalibrated = hasExplicitLeaderCalibration(right);
  if (leftCalibrated !== rightCalibrated) {
    return leftCalibrated ? -1 : 1;
  }
  const leftCoversTarget = left.actuatorCount >= requiredActuatorCount;
  const rightCoversTarget = right.actuatorCount >= requiredActuatorCount;
  if (leftCoversTarget !== rightCoversTarget) {
    return leftCoversTarget ? -1 : 1;
  }
  if (left.configuredPortMatches !== right.configuredPortMatches) {
    return left.configuredPortMatches ? -1 : 1;
  }
  const leftRoleAffinity = scoreLeaderControlPartRoleAffinity(left);
  const rightRoleAffinity = scoreLeaderControlPartRoleAffinity(right);
  if (leftRoleAffinity !== rightRoleAffinity) {
    return rightRoleAffinity - leftRoleAffinity;
  }
  const leftSemanticScore = scoreOperatorLeaderControlPartForTarget(
    left,
    targetJointNames,
  );
  const rightSemanticScore = scoreOperatorLeaderControlPartForTarget(
    right,
    targetJointNames,
  );
  if (leftSemanticScore !== rightSemanticScore) {
    return rightSemanticScore - leftSemanticScore;
  }
  if (leftCoversTarget && rightCoversTarget) {
    return left.actuatorCount - right.actuatorCount;
  }
  return right.actuatorCount - left.actuatorCount;
};

export const listCompatibleLeaderControlParts = (
  group: OperatorTeleopControlGroup,
  leader: OperatorLeaderDevice,
): OperatorLeaderControlPart[] =>
  leader.controlParts
    .filter((part) => part.kind === group.kind && part.actuatorCount > 0)
    .sort((left, right) =>
      compareLeaderControlPartsForTarget(group, left, right),
    );

export const findCompatibleLeaderControlPart = (
  group: OperatorTeleopControlGroup,
  leader: OperatorLeaderDevice,
): OperatorLeaderControlPart | null =>
  listCompatibleLeaderControlParts(group, leader)[0] ?? null;

export const resolveLeaderControlPartTargetCompatibility = (
  group: OperatorTeleopControlGroup,
  leader: OperatorLeaderDevice,
  controlPart: OperatorLeaderControlPart,
): OperatorLeaderTargetCompatibility => {
  if (!group.teleopEnabled) {
    return { compatible: false, reason: group.disabledReason ?? "Target disabled." };
  }
  const requiredActuatorCount = resolveTeleopTargetActuatorCount(group);
  if (requiresExplicitLeaderCalibration(leader, controlPart) && !hasExplicitLeaderCalibration(controlPart)) {
    return {
      compatible: false,
      reason: "Calibration required. Rescan after calibration.",
    };
  }
  const exactMatch = controlPart.actuatorCount === requiredActuatorCount;
  const partialMatch = controlPart.actuatorCount < requiredActuatorCount;
  if (partialMatch && !canUsePartialLeaderMapping(group)) {
    return {
      compatible: false,
      reason: `${controlPart.actuatorCount} actuators detected. ${group.label} needs ${requiredActuatorCount}. Use a single-arm target for partial mapping.`,
    };
  }
  return {
    compatible: true,
    reason: exactMatch
      ? ""
      : partialMatch
        ? `${controlPart.actuatorCount} of ${requiredActuatorCount} ${group.label} axes will move. Remaining joints stay unchanged.`
        : `First ${requiredActuatorCount} ${group.label} axes will move.`,
  };
};

export const resolveLeaderTargetCompatibility = (
  group: OperatorTeleopControlGroup,
  leader: OperatorLeaderDevice,
): OperatorLeaderTargetCompatibility => {
  if (!group.teleopEnabled) {
    return { compatible: false, reason: group.disabledReason ?? "Target disabled." };
  }
  const requiredActuatorCount = resolveTeleopTargetActuatorCount(group);
  const compatiblePart = findCompatibleLeaderControlPart(group, leader);
  if (compatiblePart) {
    return resolveLeaderControlPartTargetCompatibility(
      group,
      leader,
      compatiblePart,
    );
  }
  const sameKindParts = leader.controlParts.filter((part) => part.kind === group.kind);
  if (sameKindParts.length > 0) {
    return {
      compatible: false,
      reason: `Detected ${sameKindParts
        .map((part) => `${part.actuatorCount}-actuator ${part.kind}`)
        .join(", ")}. ${group.label} needs ${requiredActuatorCount} actuators.`,
    };
  }
  if (leader.motorProbeError) {
    return {
      compatible: false,
      reason: LEADER_MOTOR_PROBE_TEXT.blockedReason,
    };
  }
  if (leader.motorCount > 0) {
    return {
      compatible: false,
      reason: `Detected ${leader.motorCount} motors. ${group.label} needs ${requiredActuatorCount}.`,
    };
  }
  return {
    compatible: false,
    reason: `No ${group.kind} motors detected.`,
  };
};

export const resolveLeaderSideForControlGroup = (
  group: OperatorTeleopControlGroup,
): OperatorLeaderAssignmentSide =>
  group.id === LEADER_CONTROL_GROUP_IDS.leftArm
    ? "left"
    : group.id === LEADER_CONTROL_GROUP_IDS.rightArm
      ? "right"
      : "both";

export const resolveLeaderTargetSelection = ({
  targetGroups,
  leader,
  assignment,
  pendingTargetGroupId,
  preferredTargetGroupId = null,
}: {
  targetGroups: readonly OperatorTeleopControlGroup[];
  leader: OperatorLeaderDevice;
  assignment: Pick<OperatorLeaderAssignment, "side" | "targetGroupId"> | null;
  pendingTargetGroupId: string | null;
  preferredTargetGroupId?: string | null;
}): OperatorLeaderTargetSelection => {
  const targetOptions = targetGroups.map((group) => ({
    group,
    side: resolveLeaderSideForControlGroup(group),
    compatibility: resolveLeaderTargetCompatibility(group, leader),
  }));
  const selectableTargetOptions = targetOptions.filter(
    (option) => option.compatibility.compatible,
  );
  const connectedTargetOption = assignment
    ? targetOptions.find((option) => {
        const groupSide = option.side;
        return (
          assignment.targetGroupId === option.group.id ||
          (!assignment.targetGroupId &&
            (assignment.side === groupSide || groupSide === "both"))
        );
      }) ?? null
    : null;
  const pendingTargetOption =
    pendingTargetGroupId !== null
      ? targetOptions.find((option) => option.group.id === pendingTargetGroupId) ??
        null
      : null;
  const preferredTargetOption =
    preferredTargetGroupId !== null
      ? selectableTargetOptions.find(
          (option) => option.group.id === preferredTargetGroupId,
        ) ?? null
      : null;
  const selectedTargetOption =
    connectedTargetOption ??
    pendingTargetOption ??
    preferredTargetOption ??
    selectableTargetOptions[0] ??
    targetOptions[0] ??
    null;
  return {
    targetOptions,
    selectableTargetOptions,
    connectedTargetOption,
    pendingTargetOption,
    selectedTargetOption,
    selectedCompatibility: selectedTargetOption?.compatibility ?? null,
  };
};
