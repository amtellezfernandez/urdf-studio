import { OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE } from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorTeleopProfile } from "@/features/teleop/profiles/operatorTeleopProfiles";
import { resolveOperatorTeleopProfileTargetSide } from "@/features/teleop/profiles/operatorTeleopTargetSide";
import {
  buildOperatorProfileDeviceKey,
  buildOperatorProfileDeviceKeys,
  type OperatorDeviceRole,
  type OperatorDeviceRoleAssignments,
} from "@/features/teleop/transport/operatorDeviceRoleAssignments";
import type { OperatorHardwareMotionSafetyStatus } from "@/features/teleop/transport/operatorHelperApi";
import {
  buildOperatorHardwareConnectionReadinessItem,
  resolveOperatorHardwareConnectionState,
  type OperatorHardwareConnectionReadinessItem,
} from "@/features/teleop/transport/operatorHardwareConnectionPolicy";

export type FollowerHardwareReadinessItem = OperatorHardwareConnectionReadinessItem;

export type BuildFollowerHardwareReadinessItemsParams = {
  followerHardwareProfileAvailable: boolean;
  gatewayControlCapable: boolean;
  collaborationTeleopPermitted: boolean;
  leaseRequired: boolean;
  leaseHeldByThisOperator: boolean;
  followerTelemetryFreshForMotion: boolean;
  followerAuthoritativeFeedbackRecentlyReady: boolean;
  hardwareMotionSafety: OperatorHardwareMotionSafetyStatus | null;
};

export type ResolveBlockedOperatorControlMessageParams = {
  providerManifestAvailable: boolean;
  selectedProfileAvailable: boolean;
  providerControlCapable: boolean;
  collaborationTeleopPermitted: boolean;
  requestedTeleoperationModeLabel: string;
  connectedTeleoperationModeLabel: string;
  teleoperationModeMatched: boolean;
  selectedProfileRequiresLease: boolean;
  leaseHeldByOtherOperator: boolean;
  leaseHeldByThisOperator: boolean;
  selectedProfileSupportsJointJog: boolean;
  followerHardwareConnected: boolean;
  followerTelemetryFreshForMotion: boolean;
  followerHardwareMotionSafety: OperatorHardwareMotionSafetyStatus | null;
  targetMismatch: boolean;
};

export type ResolveFollowerHardwareMotionSafetyLabelParams = {
  followerHardwareMotionReady: boolean;
  followerHardwareMotionSafety: OperatorHardwareMotionSafetyStatus | null;
  followerTelemetryFreshForMotion: boolean;
  followerHardwareConnected: boolean;
};

export type ResolveFollowerHardwareConnectDisabledParams = {
  leaseBusy: boolean;
  followerHardwareConnected: boolean;
  followerHardwareDisconnectAvailable?: boolean;
  followerHardwareRoleConflict: string | null;
  followerHardwareProfileAvailable: boolean;
  gatewayControlCapable: boolean;
  collaborationTeleopPermitted: boolean;
};

export type OperatorFollowerTargetStatus =
  | "available"
  | "selected"
  | "connected"
  | "used_as_follower"
  | "used_as_leader";

export type OperatorFollowerTargetOption = {
  profileId: string;
  deviceKey: string;
  label: string;
  optionLabel: string;
  detailLines: string[];
  assignedRole: OperatorDeviceRole | null;
  status: OperatorFollowerTargetStatus;
  statusLabel: string;
};

export type BuildFollowerHardwareTargetOptionsParams = {
  profiles: readonly OperatorTeleopProfile[];
  providerId: string | null | undefined;
  assignments: OperatorDeviceRoleAssignments;
  selectedProfileId: string | null;
  connectedDeviceKey: string | null;
};

export type ResolveAssignedFollowerHardwareProfileParams = {
  profiles: readonly OperatorTeleopProfile[];
  providerId: string | null | undefined;
  assignments: OperatorDeviceRoleAssignments;
};

const FOLLOWER_TARGET_LABEL_TEXT = {
  internalTokenPattern: /\b(robot\s+gateway|gateway|joint\s+jog)\b/gi,
  followerTokenPattern: /\bfollower\b/gi,
  separatorPattern: /[_-]+/g,
  whitespacePattern: /\s+/g,
  punctuationCleanupPattern: /\s+([:/])/g,
  soModelOnlyPattern: /^so\d+$/i,
  armTokenPattern: /\barm\b/i,
  trailingSeparatorPattern: /[\s:/|-]+$/g,
} as const;

export const isFollowerArmPartProfile = (
  profile: OperatorTeleopProfile | null | undefined,
): boolean =>
  Boolean(
    profile &&
      (profile.capabilities.jointJog ||
        profile.capabilities.armJointCommand ||
        profile.capabilities.armJointState ||
        profile.controlledJointNames.length > 0),
  );

const isSingleArmFollowerProfile = (profile: OperatorTeleopProfile): boolean => {
  const armSide = resolveOperatorTeleopProfileTargetSide(profile);
  return armSide === "left" || armSide === "right";
};

export const resolveFollowerHardwareProfile = (
  profiles: readonly OperatorTeleopProfile[],
): OperatorTeleopProfile | null => {
  const realHardwareProfiles = profiles.filter(
    (profile) =>
      profile.teleoperationMode === OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
  );
  return (
    realHardwareProfiles.find(
      (profile) =>
        isFollowerArmPartProfile(profile) &&
        isSingleArmFollowerProfile(profile) &&
        !profile.capabilities.baseTwist,
    ) ??
    realHardwareProfiles.find(
      (profile) =>
        isFollowerArmPartProfile(profile) && !profile.capabilities.baseTwist,
    ) ??
    realHardwareProfiles.find(isFollowerArmPartProfile) ??
    null
  );
};

export const resolveAssignedFollowerHardwareProfile = ({
  profiles,
  providerId,
  assignments,
}: ResolveAssignedFollowerHardwareProfileParams): OperatorTeleopProfile | null =>
  profiles.find((profile) => {
    if (
      profile.teleoperationMode !== OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE ||
      !isFollowerArmPartProfile(profile)
    ) {
      return false;
    }
    return buildOperatorProfileDeviceKeys({ providerId, profile }).some(
      (deviceKey) => assignments[deviceKey] === "follower",
    );
  }) ?? null;

const resolveFollowerTargetAssignedRole = (
  assignments: OperatorDeviceRoleAssignments,
  deviceKeys: readonly string[],
): OperatorDeviceRole | null => {
  if (deviceKeys.some((deviceKey) => assignments[deviceKey] === "leader")) {
    return "leader";
  }
  if (deviceKeys.some((deviceKey) => assignments[deviceKey] === "follower")) {
    return "follower";
  }
  return null;
};

const resolveFollowerTargetStatusLabel = (
  status: OperatorFollowerTargetStatus,
): string => {
  switch (status) {
    case "connected":
      return "connected";
    case "used_as_leader":
      return "used as leader";
    case "used_as_follower":
      return "used as follower";
    case "selected":
      return "selected";
    default:
      return "available";
  }
};

const resolveFollowerTargetStatus = ({
  assignedRole,
  connected,
  selected,
}: {
  assignedRole: OperatorDeviceRole | null;
  connected: boolean;
  selected: boolean;
}): OperatorFollowerTargetStatus => {
  if (connected) return "connected";
  if (assignedRole === "leader") return "used_as_leader";
  if (assignedRole === "follower") return "used_as_follower";
  if (selected) return "selected";
  return "available";
};

const formatFollowerSideArmLabel = (
  profile: OperatorTeleopProfile,
): string => {
  const side = resolveOperatorTeleopProfileTargetSide(profile);
  if (side === "left" || side === "right") {
    return `${side[0].toUpperCase()}${side.slice(1)} arm`;
  }
  return "Arm";
};

const cleanFollowerTargetLabel = (value: string): string =>
  value
    .replace(FOLLOWER_TARGET_LABEL_TEXT.separatorPattern, " ")
    .replace(FOLLOWER_TARGET_LABEL_TEXT.internalTokenPattern, " ")
    .replace(FOLLOWER_TARGET_LABEL_TEXT.followerTokenPattern, " ")
    .replace(FOLLOWER_TARGET_LABEL_TEXT.punctuationCleanupPattern, "$1")
    .replace(FOLLOWER_TARGET_LABEL_TEXT.whitespacePattern, " ")
    .replace(FOLLOWER_TARGET_LABEL_TEXT.trailingSeparatorPattern, "")
    .trim();

const formatFollowerTargetLabel = (profile: OperatorTeleopProfile): string => {
  const cleaned = cleanFollowerTargetLabel(
    profile.controlTargetLabel || profile.label,
  );
  if (
    !cleaned ||
    FOLLOWER_TARGET_LABEL_TEXT.soModelOnlyPattern.test(cleaned)
  ) {
    return formatFollowerSideArmLabel(profile);
  }
  if (
    profile.robotFamily === "manipulator" &&
    !FOLLOWER_TARGET_LABEL_TEXT.armTokenPattern.test(cleaned)
  ) {
    return `${cleaned} arm`;
  }
  return cleaned;
};

const buildFollowerTargetDetailLines = (
  profile: OperatorTeleopProfile,
  deviceKey: string,
): string[] => {
  const lines: string[] = [];
  if (profile.hardwareDeviceKey) {
    lines.push(
      profile.hardwareDeviceKey.startsWith("/dev/")
        ? `Port: ${profile.hardwareDeviceKey}`
        : `Target: ${profile.hardwareDeviceKey}`,
    );
  } else if (deviceKey && !deviceKey.startsWith("provider:")) {
    lines.push(`Target: ${deviceKey}`);
  }
  if (profile.controlledJointNames.length > 0) {
    lines.push(`${profile.controlledJointNames.length} joints`);
  }
  return lines;
};

export const buildFollowerHardwareTargetOptions = ({
  profiles,
  providerId,
  assignments,
  selectedProfileId,
  connectedDeviceKey,
}: BuildFollowerHardwareTargetOptionsParams): OperatorFollowerTargetOption[] => {
  const followerProfiles = profiles.filter(
    (profile) =>
      profile.teleoperationMode === OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE &&
      isFollowerArmPartProfile(profile),
  );

  return followerProfiles.map((profile) => {
    const deviceKey = buildOperatorProfileDeviceKey({ providerId, profile });
    const deviceKeys = buildOperatorProfileDeviceKeys({ providerId, profile });
    const assignedRole = resolveFollowerTargetAssignedRole(
      assignments,
      deviceKeys,
    );
    const selected = profile.id === selectedProfileId;
    const connected = connectedDeviceKey === deviceKey;
    const status = resolveFollowerTargetStatus({
      assignedRole,
      connected,
      selected,
    });
    const statusLabel = resolveFollowerTargetStatusLabel(status);
    const label = formatFollowerTargetLabel(profile);
    return {
      profileId: profile.id,
      deviceKey,
      label,
      optionLabel:
        status === "available" || status === "selected"
          ? label
          : `${label} (${statusLabel})`,
      detailLines: buildFollowerTargetDetailLines(profile, deviceKey),
      assignedRole,
      status,
      statusLabel,
    };
  });
};

export const buildFollowerHardwareReadinessItems = ({
  followerHardwareProfileAvailable,
  gatewayControlCapable,
  collaborationTeleopPermitted,
  leaseRequired,
  leaseHeldByThisOperator,
  followerTelemetryFreshForMotion,
  followerAuthoritativeFeedbackRecentlyReady,
  hardwareMotionSafety,
}: BuildFollowerHardwareReadinessItemsParams): FollowerHardwareReadinessItem[] => {
  const gatewayReady = followerHardwareProfileAvailable && gatewayControlCapable;
  const leaseReady = !leaseRequired || leaseHeldByThisOperator;
  const calibrationReady =
    hardwareMotionSafety?.jointRotationCalibrationReady === true;
  const collisionReady =
    hardwareMotionSafety?.selfCollisionPreflightReady === true;

  return [
    buildOperatorHardwareConnectionReadinessItem({
      id: "gateway",
      label: "Follower target",
      ready: gatewayReady,
      readyDetail: "Control target is available.",
      blockedDetail: "Start robot hardware control for this target.",
    }),
    buildOperatorHardwareConnectionReadinessItem({
      id: "permission",
      label: "Teleop permission",
      ready: collaborationTeleopPermitted,
      readyDetail: "This session may request hardware control.",
      blockedDetail: "Open a shared link that includes teleop permission.",
    }),
    buildOperatorHardwareConnectionReadinessItem({
      id: "lease",
      label: "Control lease",
      ready: leaseReady,
      readyDetail: "This browser owns the hardware lease.",
      blockedDetail: "Click Connect to request the hardware lease.",
    }),
    buildOperatorHardwareConnectionReadinessItem({
      id: "feedback",
      label: "Follower feedback",
      ready: followerAuthoritativeFeedbackRecentlyReady,
      readyDetail: "Recent CAN feedback is authoritative.",
      blockedDetail: "Waiting for follower joint feedback.",
    }),
    buildOperatorHardwareConnectionReadinessItem({
      id: "joint-calibration",
      label: "Joint rotation calibration",
      ready: calibrationReady,
      readyDetail: `Calibration ${hardwareMotionSafety?.jointRotationCalibrationId ?? "loaded"} is active.`,
      blockedDetail:
        "Load a per-robot rotation calibration file on the robot/CAN host.",
    }),
    buildOperatorHardwareConnectionReadinessItem({
      id: "telemetry",
      label: "Fresh telemetry",
      ready: followerTelemetryFreshForMotion,
      readyDetail: "Follower telemetry is fresh enough for motion.",
      blockedDetail: "Waiting for current follower joint positions.",
    }),
    buildOperatorHardwareConnectionReadinessItem({
      id: "self-collision",
      label: "Self-collision preflight",
      ready: collisionReady,
      readyDetail: "Local OpenArm collision preflight is ready.",
      blockedDetail:
        "The backend must load the OpenArm URDF collision model before motion.",
    }),
  ];
};

export const resolveBlockedOperatorControlMessage = ({
  providerManifestAvailable,
  selectedProfileAvailable,
  providerControlCapable,
  collaborationTeleopPermitted,
  requestedTeleoperationModeLabel,
  connectedTeleoperationModeLabel,
  teleoperationModeMatched,
  selectedProfileRequiresLease,
  leaseHeldByOtherOperator,
  leaseHeldByThisOperator,
  selectedProfileSupportsJointJog,
  followerHardwareConnected,
  followerTelemetryFreshForMotion,
  followerHardwareMotionSafety,
  targetMismatch,
}: ResolveBlockedOperatorControlMessageParams): string => {
  if (!providerManifestAvailable) {
    return "No teleop provider manifest. Connect a robot provider before control.";
  }
  if (!selectedProfileAvailable) {
    return "Teleop provider did not advertise a usable control profile.";
  }
  if (!providerControlCapable) {
    return "Teleop provider did not grant teleop control.";
  }
  if (!collaborationTeleopPermitted) {
    return "This collaboration link does not include teleop permission.";
  }
  if (!teleoperationModeMatched) {
    return `Teleoperation mode mismatch. Selected ${requestedTeleoperationModeLabel}; connected robot is ${connectedTeleoperationModeLabel}.`;
  }
  if (selectedProfileRequiresLease && leaseHeldByOtherOperator) {
    return "Control lease is already held by another operator.";
  }
  if (selectedProfileRequiresLease && !leaseHeldByThisOperator) {
    return "Request a control lease before sending hardware commands.";
  }
  if (
    selectedProfileSupportsJointJog &&
    followerHardwareConnected &&
    !followerTelemetryFreshForMotion
  ) {
    return "Follower telemetry is not fresh enough for hardware motion.";
  }
  if (
    selectedProfileSupportsJointJog &&
    followerHardwareConnected &&
    followerHardwareMotionSafety?.motionReady !== true
  ) {
    return (
      followerHardwareMotionSafety?.lastRejectReason ||
      "Follower hardware safety preflight is not ready."
    );
  }
  return targetMismatch
    ? "Model mismatch."
    : "No active operator session.";
};

export const resolveFollowerHardwareMotionSafetyLabel = ({
  followerHardwareMotionReady,
  followerHardwareMotionSafety,
  followerTelemetryFreshForMotion,
  followerHardwareConnected,
}: ResolveFollowerHardwareMotionSafetyLabelParams): string => {
  if (followerHardwareMotionReady) return "Motion safety ready";
  if (followerHardwareMotionSafety?.lastRejectReason) {
    return followerHardwareMotionSafety.lastRejectReason;
  }
  if (!followerTelemetryFreshForMotion && followerHardwareConnected) {
    return "Waiting for fresh follower telemetry";
  }
  return "Motion safety not ready";
};

export const resolveFollowerHardwareConnectDisabled = ({
  leaseBusy,
  followerHardwareConnected,
  followerHardwareDisconnectAvailable = followerHardwareConnected,
  followerHardwareRoleConflict,
  followerHardwareProfileAvailable,
  gatewayControlCapable,
  collaborationTeleopPermitted,
}: ResolveFollowerHardwareConnectDisabledParams): boolean => {
  if (followerHardwareDisconnectAvailable) return leaseBusy;
  return resolveOperatorHardwareConnectionState({
    deviceAvailable: followerHardwareProfileAvailable,
    operationBusy: leaseBusy,
    alreadyConnected: followerHardwareConnected,
    roleConflict: followerHardwareRoleConflict,
    connectionPrerequisitesReady:
      gatewayControlCapable && collaborationTeleopPermitted,
  }).connectDisabled;
};
