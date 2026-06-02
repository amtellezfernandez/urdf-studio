import {
  OPERATOR_TELEOPERATION_MODE_FAKE_ADAPTER_ID,
  OPERATOR_TELEOPERATION_MODE_LABELS,
  OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
  OPERATOR_TELEOPERATION_MODE_SIMULATED,
  OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorTeleopControlTargetSide } from "@/features/teleop/profiles/operatorTeleopTargetSide";

export type OperatorTeleopProfileId = string;

export type OperatorTeleopTransport = "robot_gateway";
export type OperatorTeleoperationMode =
  | typeof OPERATOR_TELEOPERATION_MODE_SIMULATED
  | typeof OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE
  | typeof OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC;

export type OperatorTeleopProfileCapabilities = {
  baseTwist: boolean;
  lateralStrafe: boolean;
  armJointState: boolean;
  armJointCommand: boolean;
  stateMirroring: boolean;
  jointJog: boolean;
  gripper: boolean;
  targetPoseIk: boolean;
};

export type OperatorTeleopProfileTopics = {
  twist?: string;
  odom?: string;
  jointStates?: string[];
  battery?: string;
  armCommand?: string;
  gotoJointService?: string;
  jointJog?: string;
  robotState?: string;
};

export type OperatorTeleopProfileLimits = {
  maxLinearSpeedMps: number;
  maxYawSpeedRps: number;
  commandTickMs: number;
  deadmanTimeoutMs: number;
  maxJointJogDeltaRad: number;
  defaultJointJogStepRad: number;
  maxJointVelocityRadPerSec: number;
};

export type OperatorTeleopControlInputKind =
  | "keyboard"
  | "joystick"
  | "leader_arm"
  | "spacemouse"
  | "policy"
  | "custom";

export type OperatorTeleopControlInput = {
  id: string;
  kind: OperatorTeleopControlInputKind;
  label: string;
  summary: string;
};

export type OperatorTeleopProfile = {
  id: OperatorTeleopProfileId;
  label: string;
  summary: string;
  controlTargetLabel: string;
  controlTargetSide?: OperatorTeleopControlTargetSide | null;
  transport: OperatorTeleopTransport;
  robotFamily: "manipulator" | "mobile_base" | "mobile_manipulator";
  robotId: string;
  adapterId: string;
  teleoperationMode: OperatorTeleoperationMode;
  hardwareDeviceKey?: string;
  hardwareDeviceKeys?: string[];
  controlledJointNames: string[];
  controlInputs: OperatorTeleopControlInput[];
  capabilities: OperatorTeleopProfileCapabilities;
  topics: OperatorTeleopProfileTopics;
  limits: OperatorTeleopProfileLimits;
};

export const getOperatorTeleopProfile = (
  profiles: readonly OperatorTeleopProfile[] | null | undefined,
  profileId: OperatorTeleopProfileId | null
): OperatorTeleopProfile | null => {
  if (!profileId) return null;
  return profiles?.find((profile) => profile.id === profileId) ?? null;
};

export const clampOperatorProfileSpeed = (value: number, max: number): number =>
  Math.min(Math.max(value, 0), max);

export const resolveOperatorTeleoperationMode = (
  teleoperationMode: unknown,
  adapterId: string | null | undefined,
): OperatorTeleoperationMode => {
  if (teleoperationMode === OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE) {
    return OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE;
  }
  if (teleoperationMode === OPERATOR_TELEOPERATION_MODE_SIMULATED) {
    return OPERATOR_TELEOPERATION_MODE_SIMULATED;
  }
  if (teleoperationMode === OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC) {
    return OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC;
  }
  if (!adapterId) {
    return OPERATOR_TELEOPERATION_MODE_SIMULATED;
  }
  return adapterId === OPERATOR_TELEOPERATION_MODE_FAKE_ADAPTER_ID
    ? OPERATOR_TELEOPERATION_MODE_SIMULATED
    : OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE;
};

export const getOperatorTeleoperationModeLabel = (
  mode: OperatorTeleoperationMode,
): string => OPERATOR_TELEOPERATION_MODE_LABELS[mode];

export const describeOperatorProfileCapabilities = (
  profile: OperatorTeleopProfile
): string => {
  const capabilities = [
    profile.capabilities.baseTwist ? "base twist" : null,
    profile.capabilities.lateralStrafe ? "strafe" : null,
    profile.capabilities.armJointState ? "arm state" : null,
    profile.capabilities.armJointCommand ? "arm command" : null,
    profile.capabilities.stateMirroring ? "state mirror" : null,
    profile.capabilities.jointJog ? "joint jog" : null,
    profile.capabilities.gripper ? "gripper" : null,
    profile.capabilities.targetPoseIk ? "target pose IK" : null,
  ].filter(Boolean);

  return capabilities.length > 0 ? capabilities.join(", ") : "no control capabilities";
};

export const describeOperatorProfileTopics = (profile: OperatorTeleopProfile): string => {
  const topics = [
    profile.topics.twist,
    profile.topics.odom,
    ...(profile.topics.jointStates ?? []),
    profile.topics.battery,
    profile.topics.armCommand,
    profile.topics.gotoJointService,
    profile.topics.jointJog,
    profile.topics.robotState,
  ].filter(Boolean);

  return topics.length > 0 ? topics.join(", ") : "provider did not advertise robot topics";
};

export const describeOperatorProfileControlInputs = (
  profile: OperatorTeleopProfile
): string => {
  const inputs = profile.controlInputs
    .map((input) => input.label || input.kind)
    .filter(Boolean);

  return inputs.length > 0 ? inputs.join(", ") : "provider did not advertise control inputs";
};
