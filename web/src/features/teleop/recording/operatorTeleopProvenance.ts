import {
  OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE,
  OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC,
  OPERATOR_TELEOP_INPUT_SOURCE_ESTOP,
  OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY,
  OPERATOR_TELEOP_INPUT_SOURCE_IK_DRAG,
  OPERATOR_TELEOP_INPUT_SOURCE_JOINT_JOG,
  OPERATOR_TELEOP_INPUT_SOURCE_KEYBOARD,
  OPERATOR_TELEOP_PHYSICS_SOURCE_GATEWAY_PROXY,
  OPERATOR_TELEOP_PHYSICS_SOURCE_NONE,
  OPERATOR_TELEOP_PHYSICS_SOURCE_REAL_WORLD,
  OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC,
  OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC,
} from "@/features/teleop/params/operatorTeleopParams";
import type { OperatorTeleoperationMode } from "@/features/teleop/profiles/operatorTeleopProfiles";
import { isOperatorTeleopGatewayReplayCommandKind } from "@/features/teleop/recording/operatorTeleopRecordingParams";

export type OperatorTeleopRecordingInputSource =
  | typeof OPERATOR_TELEOP_INPUT_SOURCE_IK_DRAG
  | typeof OPERATOR_TELEOP_INPUT_SOURCE_IK_APPLY
  | typeof OPERATOR_TELEOP_INPUT_SOURCE_JOINT_JOG
  | typeof OPERATOR_TELEOP_INPUT_SOURCE_KEYBOARD
  | typeof OPERATOR_TELEOP_INPUT_SOURCE_ESTOP;

export type OperatorTeleopRecordingPhysicsSource =
  | typeof OPERATOR_TELEOP_PHYSICS_SOURCE_NONE
  | typeof OPERATOR_TELEOP_PHYSICS_SOURCE_GATEWAY_PROXY
  | typeof OPERATOR_TELEOP_PHYSICS_SOURCE_REAL_WORLD;

export type OperatorTeleopRecordingReplayGuarantee =
  | typeof OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC
  | typeof OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC;

export type OperatorTeleopRecordingProvenance = {
  physicsSource: OperatorTeleopRecordingPhysicsSource;
  replayGuarantee: OperatorTeleopRecordingReplayGuarantee;
};

type OperatorTeleopSampleForProvenance = {
  command: {
    kind: string;
  };
  context: {
    teleoperationMode: OperatorTeleoperationMode | null;
    physicsSource: OperatorTeleopRecordingPhysicsSource;
    replayGuarantee: OperatorTeleopRecordingReplayGuarantee;
  };
};

type OperatorTeleopEpisodeForProvenance = {
  samples: readonly OperatorTeleopSampleForProvenance[];
};

export type OperatorTeleopLeRobotExportMode =
  | "gateway_replay"
  | "studio_kinematic";

export type OperatorTeleopEpisodeClass =
  | "empty"
  | "studio_kinematic"
  | "gateway_replay"
  | "mixed_invalid";

export const resolveOperatorTeleopRecordingProvenance = (
  mode: OperatorTeleoperationMode,
): OperatorTeleopRecordingProvenance => {
  if (mode === OPERATOR_TELEOPERATION_MODE_REAL_HARDWARE) {
    return {
      physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_REAL_WORLD,
      replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC,
    };
  }
  if (mode === OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC) {
    return {
      physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_NONE,
      replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC,
    };
  }
  return {
    physicsSource: OPERATOR_TELEOP_PHYSICS_SOURCE_GATEWAY_PROXY,
    replayGuarantee: OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC,
  };
};

const isOperatorTeleopStudioKinematicSample = (
  sample: OperatorTeleopSampleForProvenance,
): boolean =>
  sample.command.kind === "joint_targets" &&
  sample.context.teleoperationMode === OPERATOR_TELEOPERATION_MODE_STUDIO_KINEMATIC &&
  sample.context.physicsSource === OPERATOR_TELEOP_PHYSICS_SOURCE_NONE &&
  sample.context.replayGuarantee === OPERATOR_TELEOP_REPLAY_GUARANTEE_KINEMATIC;

const isOperatorTeleopGatewayReplaySample = (
  sample: OperatorTeleopSampleForProvenance,
): boolean =>
  isOperatorTeleopGatewayReplayCommandKind(sample.command.kind) &&
  sample.context.replayGuarantee ===
    OPERATOR_TELEOP_REPLAY_GUARANTEE_GATEWAY_DETERMINISTIC &&
  (sample.context.physicsSource === OPERATOR_TELEOP_PHYSICS_SOURCE_GATEWAY_PROXY ||
    sample.context.physicsSource === OPERATOR_TELEOP_PHYSICS_SOURCE_REAL_WORLD);

export const classifyOperatorTeleopEpisode = (
  episode: OperatorTeleopEpisodeForProvenance | null,
): OperatorTeleopEpisodeClass => {
  if (!episode || episode.samples.length === 0) {
    return "empty";
  }
  if (episode.samples.every(isOperatorTeleopStudioKinematicSample)) {
    return "studio_kinematic";
  }
  if (episode.samples.every(isOperatorTeleopGatewayReplaySample)) {
    return "gateway_replay";
  }
  return "mixed_invalid";
};

export const isOperatorTeleopStudioKinematicEpisode = (
  episode: OperatorTeleopEpisodeForProvenance | null,
): boolean => classifyOperatorTeleopEpisode(episode) === "studio_kinematic";

export const canValidateOperatorTeleopReplay = (
  episode: OperatorTeleopEpisodeForProvenance | null,
): boolean => classifyOperatorTeleopEpisode(episode) === "gateway_replay";

export const resolveOperatorTeleopLeRobotExportMode = (
  episode: OperatorTeleopEpisodeForProvenance | null,
  replaySucceeded: boolean,
): OperatorTeleopLeRobotExportMode | null => {
  const episodeClass = classifyOperatorTeleopEpisode(episode);
  if (episodeClass === "studio_kinematic") {
    return episodeClass;
  }
  if (episodeClass === "gateway_replay" && replaySucceeded) {
    return episodeClass;
  }
  return null;
};

export const getOperatorTeleopLeRobotExportButtonLabel = (
  exportMode: OperatorTeleopLeRobotExportMode | null,
): string => (exportMode === "studio_kinematic" ? "Export kinematic" : "Export LeRobot");
