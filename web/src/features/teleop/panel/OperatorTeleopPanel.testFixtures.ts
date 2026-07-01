import { OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INITIAL } from "@/features/teleop/params/operatorTeleopParams";
import {
  OPENARM_HF_LIVE_REAL_SENSE_POSITION_M,
  OPENARM_HF_LIVE_REAL_SENSE_ROTATION_RPY_DEG,
} from "@/features/teleop/perception/openArmHfLiveParams";
import type { OperatorTeleopProfile } from "@/features/teleop/profiles/operatorTeleopProfiles";

const OPERATOR_TELEOP_PANEL_TEST_SCALARS = {
  TEST_PROVIDER_MAX_LINEAR_SPEED_MPS: 1,
  TEST_PROVIDER_MAX_YAW_SPEED_RPS: 3.14,
  TEST_PROVIDER_COMMAND_TICK_MS: 100,
  TEST_PROVIDER_DEADMAN_TIMEOUT_MS: 300,
  TEST_CALIBRATION_REVISION: 2,
  TEST_CALIBRATION_SESSION_ID: 1,
  TEST_LEADER_TARGET_DIRECTION: 1,
  TEST_SHOULDER_MOTOR_ID: 3,
  TEST_ELBOW_MOTOR_ID: 1,
  TEST_LIVE_RELAY_URL: "https://relay.test",
  TEST_LIVE_NAMESPACE: "robot-gateway/openarm",
} as const;

export const {
  TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
  TEST_PROVIDER_MAX_YAW_SPEED_RPS,
  TEST_PROVIDER_COMMAND_TICK_MS,
  TEST_PROVIDER_DEADMAN_TIMEOUT_MS,
  TEST_CALIBRATION_REVISION,
  TEST_CALIBRATION_SESSION_ID,
  TEST_LEADER_TARGET_DIRECTION,
  TEST_SHOULDER_MOTOR_ID,
  TEST_ELBOW_MOTOR_ID,
  TEST_LIVE_RELAY_URL,
  TEST_LIVE_NAMESPACE,
} = OPERATOR_TELEOP_PANEL_TEST_SCALARS;

export const TEST_PROVIDER_JOINT_LIMITS = {
  defaultJointJogStepRad: 0.01,
  maxJointVelocityRadPerSec: 0.5,
  none: 0,
} as const;
export const TEST_OPENARM_LEADER_TELEMETRY = {
  positionRad: 0.35,
} as const;
export const TEST_CALIBRATION_ZERO_OVERRIDES = {
  shoulderPanRad: 0.35,
  elbowFlexRad: -0.2,
} as const;
export const TEST_CALIBRATION_INITIAL_REVISION =
  OPERATOR_LEROBOT_CALIBRATION_FILE_SYNC_REVISION_INITIAL;
export const TEST_CAMERA_FIXTURE = {
  widthPx: 48,
  heightPx: 32,
  focalPx: 46,
  principalPointPx: 24,
  pointCloudSourceTsMs: 200,
  pointCloudSequence: 1,
  point: [0.1, 0.2, 0.3],
  color: [1, 0, 0],
} as const;
export const TEST_CAMERA_POSE = {
  position: [0.3, 0, 0],
  rotationRpyDeg: [0, 0, 0],
  scale: 0.001,
  worldFrame: "urdf_z_up",
} as const;
export const TEST_CAMERA_CONFIG_POSE = {
  position: [...OPENARM_HF_LIVE_REAL_SENSE_POSITION_M],
  rotationRpyDeg: [...OPENARM_HF_LIVE_REAL_SENSE_ROTATION_RPY_DEG],
  scale: 0.001,
  worldFrame: "urdf_z_up",
} as const;
export const TEST_CAMERA_STREAM = {
  id: "openarm_depth_camera",
  label: "OpenArm depth camera",
  kind: "rgbd",
  frame_id: "openarm_depth_camera",
  coordinate_frame: "robot_world",
  intrinsics: {
    width: TEST_CAMERA_FIXTURE.widthPx,
    height: TEST_CAMERA_FIXTURE.heightPx,
    fx: TEST_CAMERA_FIXTURE.focalPx,
    fy: TEST_CAMERA_FIXTURE.focalPx,
    ppx: TEST_CAMERA_FIXTURE.principalPointPx,
    ppy: TEST_CAMERA_FIXTURE.principalPointPx,
  },
  capabilities: {
    color: true,
    depth: true,
    point_cloud: true,
  },
  point_cloud_path: "/perception/cameras/openarm_depth_camera/point-cloud",
  camera_pose: {
    position: TEST_CAMERA_POSE.position,
    rotation_rpy_deg: TEST_CAMERA_POSE.rotationRpyDeg,
    scale: TEST_CAMERA_POSE.scale,
    world_frame: TEST_CAMERA_POSE.worldFrame,
  },
} as const;
export const TEST_CAMERA_VIDEO_TRACK_NAME = `camera/${TEST_CAMERA_STREAM.id}/video`;
export const TEST_CAMERA_DEPTH_TRACK_NAME = `camera/${TEST_CAMERA_STREAM.id}/depth`;
export const TEST_CAMERA_METADATA_TRACK_NAME = `camera/${TEST_CAMERA_STREAM.id}/metadata`;
export const TEST_OPENARM_LIVE_TRANSPORT = {
  type: "moq",
  relay_url: TEST_LIVE_RELAY_URL,
  namespace: TEST_LIVE_NAMESPACE,
  tracks: [
    {
      id: "openarm-video",
      kind: "video",
      track_name: TEST_CAMERA_VIDEO_TRACK_NAME,
      encoding: "h264",
      camera_id: TEST_CAMERA_STREAM.id,
    },
    {
      id: "openarm-depth",
      kind: "depth",
      track_name: TEST_CAMERA_DEPTH_TRACK_NAME,
      encoding: "depth16",
      camera_id: TEST_CAMERA_STREAM.id,
    },
    {
      id: "openarm-metadata",
      kind: "metadata",
      track_name: TEST_CAMERA_METADATA_TRACK_NAME,
      encoding: "json",
      camera_id: TEST_CAMERA_STREAM.id,
    },
  ],
} as const;
export const TEST_POINT_CLOUD_FRAME = {
  camera_id: TEST_CAMERA_STREAM.id,
  frame_id: TEST_CAMERA_STREAM.frame_id,
  coordinate_frame: TEST_CAMERA_STREAM.coordinate_frame,
  sequence: TEST_CAMERA_FIXTURE.pointCloudSequence,
  source_ts_ms: TEST_CAMERA_FIXTURE.pointCloudSourceTsMs,
  intrinsics: TEST_CAMERA_STREAM.intrinsics,
  points_xyz: [TEST_CAMERA_FIXTURE.point],
  colors_rgb: [TEST_CAMERA_FIXTURE.color],
} as const;
export const TEST_PROVIDER_PROFILE: OperatorTeleopProfile = {
  id: "provider_base_twist",
  label: "Provider base twist",
  summary: "Provider-owned control profile.",
  controlTargetLabel: "provider gateway",
  transport: "robot_gateway",
  capabilities: {
    baseTwist: true,
    lateralStrafe: true,
    armJointState: false,
    armJointCommand: false,
    stateMirroring: true,
    jointJog: false,
    gripper: false,
    targetPoseIk: false,
  },
  robotFamily: "mobile_base",
  robotId: "atlas",
  adapterId: "test-adapter",
  teleoperationMode: "simulated",
  controlledJointNames: [],
  controlInputs: [
    {
      id: "browser_keyboard",
      kind: "keyboard",
      label: "Browser keyboard",
      summary: "Keyboard commands from the operator panel.",
    },
    {
      id: "field_joystick",
      kind: "joystick",
      label: "Field joystick",
      summary: "External joystick mapped by the teleop provider.",
    },
  ],
  topics: {
    twist: "provider:/control/twist",
    odom: "provider:/telemetry/robot_state",
    jointStates: ["provider:/telemetry/joint_states"],
  },
  limits: {
    maxLinearSpeedMps: TEST_PROVIDER_MAX_LINEAR_SPEED_MPS,
    maxYawSpeedRps: TEST_PROVIDER_MAX_YAW_SPEED_RPS,
    commandTickMs: TEST_PROVIDER_COMMAND_TICK_MS,
    deadmanTimeoutMs: TEST_PROVIDER_DEADMAN_TIMEOUT_MS,
    maxJointJogDeltaRad: TEST_PROVIDER_JOINT_LIMITS.none,
    defaultJointJogStepRad: TEST_PROVIDER_JOINT_LIMITS.none,
    maxJointVelocityRadPerSec: TEST_PROVIDER_JOINT_LIMITS.none,
  },
};
export const TEST_PROVIDER_MANIFEST = {
  contract_version: "urdf-studio.teleop-provider.v1",
  provider_id: "test-provider",
  provider_display_name: "Test Provider",
  capabilities: {
    observe: true,
    telemetry: true,
    video: false,
    record: false,
    control: true,
    estop: true,
  },
  profiles: [
    {
      id: TEST_PROVIDER_PROFILE.id,
      label: TEST_PROVIDER_PROFILE.label,
      summary: TEST_PROVIDER_PROFILE.summary,
      control_target_label: TEST_PROVIDER_PROFILE.controlTargetLabel,
      transport: TEST_PROVIDER_PROFILE.transport,
      control_inputs: TEST_PROVIDER_PROFILE.controlInputs.map((input) => ({
        id: input.id,
        kind: input.kind,
        label: input.label,
        summary: input.summary,
      })),
      capabilities: {
        base_twist: true,
        lateral_strafe: true,
        arm_joint_state: false,
        arm_joint_command: false,
        state_mirroring: true,
      },
      topics: {
        twist: TEST_PROVIDER_PROFILE.topics.twist,
        odom: TEST_PROVIDER_PROFILE.topics.odom,
        joint_states: TEST_PROVIDER_PROFILE.topics.jointStates,
      },
      limits: {
        max_linear_speed_mps: TEST_PROVIDER_PROFILE.limits.maxLinearSpeedMps,
        max_yaw_speed_rps: TEST_PROVIDER_PROFILE.limits.maxYawSpeedRps,
        command_tick_ms: TEST_PROVIDER_PROFILE.limits.commandTickMs,
        deadman_timeout_ms: TEST_PROVIDER_PROFILE.limits.deadmanTimeoutMs,
      },
    },
  ],
  camera_streams: [TEST_CAMERA_STREAM],
};
