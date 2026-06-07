export const OPERATOR_TELEOP_RECORDING_SCHEMA_VERSION =
  "urdf-studio.teleop-recording.v1";
export const OPERATOR_TELEOP_RECORDING_DEFAULT_TASK_LANGUAGE =
  "teleoperate the robot";
export const OPERATOR_TELEOP_RECORDING_MAX_SAMPLES = 20_000;
export const OPERATOR_TELEOP_RECORDING_MAX_CAMERAS_PER_SAMPLE = 16;
export const OPERATOR_TELEOP_RECORDING_MAX_JOINTS_PER_SAMPLE = 128;
export const OPERATOR_TELEOP_RECORDING_SAMPLE_COUNT_INITIAL = 0;
export const OPERATOR_TELEOP_RECORDING_DROPPED_SAMPLE_COUNT_INITIAL = 0;
export const OPERATOR_TELEOP_VALIDATION_REQUEST_SEQUENCE_INITIAL = 0;
export const OPERATOR_TELEOP_VALIDATION_REQUEST_SEQUENCE_STEP = 1;
const OPERATOR_TELEOP_GATEWAY_REPLAY_COMMAND_KINDS = [
  "joint_jog",
  "stop",
  "estop",
] as const;
export const OPERATOR_TELEOP_REPLAY_VALIDATE_PATH = "/teleop/replay/validate";
export const OPERATOR_TELEOP_REPLAY_LEROBOT_EXPORT_PATH =
  "/teleop/replay/export/lerobot";
export const OPERATOR_TELEOP_KINEMATIC_LEROBOT_EXPORT_PATH =
  "/teleop/replay/export/kinematic/lerobot";
export const OPERATOR_TELEOP_MJLAB_VALIDATE_PATH = "/teleop/mjlab/validate";
export const OPERATOR_TELEOP_MJLAB_ROLLOUT_PATH = "/teleop/mjlab/rollout";

export type OperatorTeleopGatewayReplayCommandKind =
  (typeof OPERATOR_TELEOP_GATEWAY_REPLAY_COMMAND_KINDS)[number];

export const isOperatorTeleopGatewayReplayCommandKind = (
  commandKind: string,
): commandKind is OperatorTeleopGatewayReplayCommandKind =>
  OPERATOR_TELEOP_GATEWAY_REPLAY_COMMAND_KINDS.some(
    (supportedKind) => supportedKind === commandKind,
  );
