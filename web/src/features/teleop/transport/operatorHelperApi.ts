import { API_BASE_URL } from "@/shared/config/runtime";
import { COLLABORATION_SESSION_TOKEN_HEADER } from "@/features/collaboration/collaborationTransport";
import { normalizeLiveTransportDescriptor } from "@/features/live-transport/liveTransportCodec";
import type { LiveTransportDescriptor } from "@/features/live-transport/liveTransportTypes";
import {
  normalizeOperatorControlTransportDescriptor,
  type OperatorControlTransportDescriptor,
} from "@/features/teleop/transport/operatorControlTransport";
import type {
  OperatorCommandMetadata,
  OperatorJointJogCommand,
  OperatorJointJogCommandPayload,
  OperatorOpenArmCalibrationJogCommand,
  OperatorOpenArmCalibrationJogCommandPayload,
  OperatorTwistCommand,
  OperatorTwistCommandPayload,
} from "@/features/teleop/contracts/operatorControlTypes";
import {
  OPERATOR_HELPER_AUTHORIZED_PROVIDER_MANIFEST_PATH,
  OPERATOR_HELPER_COMMAND_SEQUENCE_INITIAL,
  OPERATOR_HELPER_ENV_CONFIG_PATH,
  OPERATOR_HELPER_ESTOP_PATH,
  OPERATOR_HELPER_FOLLOWER_PATHS,
  OPERATOR_HELPER_FOLLOWER_RELEASE_PATH,
  OPERATOR_HELPER_JOINT_JOG_PATH,
  OPERATOR_HELPER_JOINT_JOG_CAN_DRY_RUN_PATH,
  OPERATOR_HELPER_LEADER_DETECTION_PATH,
  OPERATOR_HELPER_LEADER_PATHS,
  OPERATOR_HELPER_LEADER_RELEASE_PATH,
  OPERATOR_HELPER_LEADER_STATE_PATH,
  OPERATOR_HELPER_LEROBOT_CALIBRATION_OPEN_PATH,
  OPERATOR_HELPER_LEROBOT_CALIBRATION_SYNC_PATH,
  OPERATOR_HELPER_LEROBOT_CALIBRATIONS_PATH,
  OPERATOR_HELPER_LEASE_RELEASE_PATH,
  OPERATOR_HELPER_LEASE_REQUEST_PATH,
  OPERATOR_HELPER_LOCAL_GATEWAY_PATH,
  OPERATOR_HELPER_OPENARM_CALIBRATION_JOG_PATH,
  OPERATOR_HELPER_POINT_CLOUD_PATH_SUFFIX,
  OPERATOR_HELPER_PROVIDER_MANIFEST_PATH,
  OPERATOR_HELPER_STOP_PATH,
  OPERATOR_HELPER_TELEMETRY_STATE_PATH,
  OPERATOR_HELPER_TWIST_PATH,
  OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS,
} from "@/features/teleop/params/operatorTeleopParams";
import type {
  OperatorTeleopControlInput,
  OperatorTeleopControlInputKind,
  OperatorTeleopProfile,
} from "@/features/teleop/profiles/operatorTeleopProfiles";
import { resolveOperatorTeleoperationMode } from "@/features/teleop/profiles/operatorTeleopProfiles";

const DEFAULT_OPERATOR_HELPER_BASE_URL = `${API_BASE_URL}${OPERATOR_HELPER_LOCAL_GATEWAY_PATH}`;
export const OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL =
  DEFAULT_OPERATOR_HELPER_BASE_URL;

export const OPERATOR_HELPER_BASE_URL =
  import.meta.env.VITE_OPERATOR_HELPER_BASE_URL ||
  DEFAULT_OPERATOR_HELPER_BASE_URL;
export const OPERATOR_HELPER_BROWSER_TOKEN =
  import.meta.env.VITE_OPERATOR_HELPER_BROWSER_TOKEN || "";
export const OPERATOR_HELPER_COLLABORATION_SESSION_HEADER =
  "X-URDF-Collaboration-Session";
export const OPERATOR_HELPER_COLLABORATION_TELEOP_CAPABILITY_HEADER =
  "X-URDF-Collaboration-Teleop-Capability";

export type OperatorConnectionState = "idle" | "connecting" | "active" | "closing" | "closed";

export type OperatorControlMode = "manual" | "shared_autonomy" | "safe_hold";

export type OperatorSessionSnapshot = {
  state: OperatorConnectionState;
  current_session_id: string | null;
  robot_id: string | null;
  model_robot_id?: string | null;
  model_robot_aliases?: string[] | null;
  mode: OperatorControlMode;
  runtime_mode?: "observe" | "control";
  adapter_id?: string;
  teleoperation_mode?: OperatorTeleopProfile["teleoperationMode"];
  active_profile_id?: string;
  control_lease_owner?: string | null;
};

export type OperatorStatsSnapshot = {
  operator_rtt_ms: number | null;
  estimated_end_to_end_latency_ms: number | null;
  robot_state: {
    mode: OperatorControlMode;
    connection_state: OperatorConnectionState;
    estop: boolean;
    control_rtt_ms: number | null;
  };
};

export type OperatorControlRestAck = {
  ok?: boolean;
  accepted: boolean;
  reason: string;
  sequence: number;
  session_id?: string;
  applied_joint_name?: string | null;
  applied_delta_rad?: number | null;
};

export type OperatorGatewayStateFrame = {
  robotId: string;
  adapterId: string;
  profileId: string;
  sequence: number;
  sourceTsMs: number;
  mode: OperatorControlMode;
  estop: boolean;
  heartbeatOk: boolean;
  jointPositionsRad: Record<string, number>;
  gripperPositionsRad: Record<string, number>;
  jointTelemetry: Record<string, OperatorGatewayJointTelemetry>;
  hardwareMotionSafety: OperatorHardwareMotionSafetyStatus;
};

export type OperatorGatewayJointTelemetry = {
  positionRad: number;
  velocityRadPerSec: number | null;
  torqueNm: number | null;
  tempMosC: number | null;
  tempRotorC: number | null;
  faultCode: number | null;
};

export type OperatorHardwareMotionSafetyStatus = {
  motionReady: boolean;
  authoritativeJointFeedbackReady: boolean;
  jointRotationCalibrationReady: boolean;
  jointRotationCalibrationRequired: boolean;
  jointRotationCalibrationId: string | null;
  selfCollisionPreflightReady: boolean;
  gripperMotionEnabled: boolean;
  lastRejectReason: string | null;
};

export type OperatorOpenArmCanDryRunMitParam = {
  kp: number;
  kd: number;
  q: number;
  dq: number;
  tau: number;
};

export type OperatorOpenArmCanDryRunFrame = {
  joint_name: string;
  arm_side: string;
  logical_bus: string;
  motor_type: string;
  protocol: "damiao_mit_control";
  send_can_id: number;
  recv_can_id: number;
  send_can_id_hex: string;
  recv_can_id_hex: string;
  dlc: number;
  data_bytes: number[];
  data_hex: string;
  mit_param: OperatorOpenArmCanDryRunMitParam;
  transmission_state: "dry_run_not_sent";
};

export type OperatorOpenArmCanDryRunPlan = {
  ok?: boolean;
  accepted: boolean;
  reason?: string;
  sequence?: number;
  session_id?: string;
  applied_joint_name?: string | null;
  applied_delta_rad?: number | null;
  frame?: OperatorOpenArmCanDryRunFrame | null;
};

export type OperatorLeaderControlPart = {
  id: string;
  kind: "arm" | "unknown";
  label: string;
  actuatorCount: number;
  motorBus: string | null;
  motorIds: number[];
  motorModel: string | null;
  motorModels: Record<number, string>;
  jointNames: string[];
  zeroPositionsRad: Record<string, number>;
  calibrationCategory: string | null;
  calibrationProfile: string | null;
  calibrationId: string | null;
  calibrationGroup: string | null;
  configuredPort: string | null;
  configuredPortMatches: boolean;
  configuredPortStatus: "none" | "matched" | "stale" | "unmatched";
};

export type OperatorLeaderDevice = {
  id: string;
  path: string;
  devicePath: string;
  identityKey: string;
  identityStable: boolean;
  serial: string | null;
  label: string;
  source: "serial_by_id" | "tty_glob";
  leaderType: "serial_leader_candidate" | "serial_candidate";
  hardwareFamily: "arm_controller" | "motor_chain" | "serial_unknown";
  motorBus: string | null;
  motorIds: number[];
  motorModels: Record<number, string>;
  motorCount: number;
  motorProbeError: string | null;
  controlParts: OperatorLeaderControlPart[];
  recommendedEnv: string;
  available: boolean;
};

export type OperatorOpenArmLeaderDevice = OperatorLeaderDevice;

export type OperatorRuntimeProvider = {
  id: string;
  label: string;
  kind: "hardware" | "dataflow";
  status: "available" | "needs_config" | "missing";
  connectable: boolean;
  summary: string;
  configRef: string | null;
  nodeId: string | null;
};

export type OperatorLeaderDetection = {
  leaders: OperatorLeaderDevice[];
  runtimeProviders: OperatorRuntimeProvider[];
  preferredLeaderPort: string | null;
};

export type OperatorOpenArmLeaderDetection = OperatorLeaderDetection;

export type OperatorLeaderStateSide = "left" | "right" | "both";

export type OperatorOpenArmLeaderStateSide = OperatorLeaderStateSide;

export type OperatorLeaderJointTelemetry = {
  positionRad: number;
  velocityRadPerSec: number;
  torqueNm: number;
  motorId?: number | null;
};

export type OperatorOpenArmLeaderJointTelemetry = OperatorLeaderJointTelemetry;

export type OperatorLeaderState = {
  connected: boolean;
  port: string;
  side: OperatorLeaderStateSide;
  sourceTsMs: number;
  joints: Record<string, OperatorLeaderJointTelemetry>;
  error: string | null;
};

export type OperatorOpenArmLeaderState = OperatorLeaderState;

export type OperatorLeaderReleaseRequest = {
  port?: string | null;
  portLeft?: string | null;
  portRight?: string | null;
  motorIds?: readonly number[] | null;
  motorModel?: string | null;
  calibrationCategory?: string | null;
  calibrationProfile?: string | null;
  calibrationId?: string | null;
  calibrationGroup?: string | null;
};

export type OperatorLeaderStateOptions = {
  motorIds?: readonly number[];
  motorModel?: string | null;
  calibrationCategory?: string | null;
  calibrationProfile?: string | null;
  calibrationId?: string | null;
  calibrationGroup?: string | null;
};

export type OperatorLeaderReleaseResult = {
  released: number;
};

export type OperatorLeaseResponse = {
  accepted: boolean;
  session_id?: string;
  operator_id?: string | null;
  profile_id?: string;
  reason?: string;
};

export type OperatorCollaborationAuthorization = {
  sessionId: string;
  teleopCapabilityToken?: string | null;
  ownerToken?: string | null;
};

export type OperatorProviderConnectionMode = {
  id: string;
  label: string;
  summary: string;
  maxOperatorRttMs: number | null;
  configRef: string | null;
};

export type OperatorProviderCapabilitySet = {
  observe: boolean;
  telemetry: boolean;
  video: boolean;
  record: boolean;
  control: boolean;
  estop: boolean;
};

export type OperatorCameraIntrinsics = {
  width: number;
  height: number;
  fx: number;
  fy: number;
  ppx: number;
  ppy: number;
};

export type OperatorCameraPose = {
  position: [number, number, number];
  rotationRpyDeg: [number, number, number];
  scale: number;
  worldFrame?: "urdf_z_up" | "hf_y_up";
  gravity?: [number, number, number];
  useGravityOrientation?: boolean;
};

export type OperatorCameraStream = {
  id: string;
  label: string;
  kind: "rgb" | "depth" | "rgbd";
  frameId: string;
  coordinateFrame: "robot_world" | "camera";
  intrinsics: OperatorCameraIntrinsics;
  capabilities: {
    color: boolean;
    depth: boolean;
    pointCloud: boolean;
  };
  colorStreamPath?: string;
  depthStreamPath?: string;
  metadataStreamPath?: string;
  pointCloudPath?: string;
  cameraPose?: OperatorCameraPose;
};

export type OperatorPointCloudFrame = {
  cameraId: string;
  frameId: string;
  coordinateFrame: "robot_world" | "camera";
  sequence: number;
  sourceTsMs: number;
  intrinsics: OperatorCameraIntrinsics;
  pointsXyz: [number, number, number][];
  colorsRgb: [number, number, number][];
  pointsXyzFlat?: Float32Array;
  colorsRgbFlat?: Float32Array;
  pointCount?: number;
  cameraPose?: OperatorCameraPose;
};

export type OperatorProviderManifest = {
  contractVersion: string;
  providerId: string;
  providerDisplayName: string;
  connectionModes: OperatorProviderConnectionMode[];
  capabilities: OperatorProviderCapabilitySet;
  profiles: OperatorTeleopProfile[];
  cameraStreams: OperatorCameraStream[];
  liveTransport: LiveTransportDescriptor | null;
  controlTransport: OperatorControlTransportDescriptor | null;
};

export type OperatorGatewayEnvConfigFile = {
  path: string;
  content: string;
  exists: boolean;
};

export type OperatorGatewayEnvConfigOpenResult = {
  path: string;
  exists: boolean;
  opened: boolean;
  message: string;
};

export type OperatorLeRobotCalibrationStartResult = {
  started: boolean;
  command: string[];
  displayCommand: string;
  message: string;
};

export type OperatorLeRobotCalibrationSource = {
  category: string;
  profileId: string;
  calibrationId: string;
  calibrationDir: string;
  groupId: string;
};

export type OperatorLeRobotCalibrationCatalogEntry =
  OperatorLeRobotCalibrationSource & {
    id: string;
    path: string;
    jointNames: string[];
    motorIds: number[];
    zeroPositionsRad: Record<string, number>;
    actuatorCount: number;
  };

export type OperatorLeRobotCalibrationCatalog = {
  entries: OperatorLeRobotCalibrationCatalogEntry[];
  activeSource: OperatorLeRobotCalibrationSource | null;
};

export type OperatorLeRobotCalibrationFileSyncRole = "leader" | "follower";

export type OperatorLeRobotCalibrationFileSyncRequest = {
  role: OperatorLeRobotCalibrationFileSyncRole;
  calibrationSource: OperatorLeRobotCalibrationSource;
  lastMtimeNs?: number | null;
  leaderPort?: string | null;
  leaderMotorIds?: readonly number[] | null;
  leaderMotorModel?: string | null;
};

export type OperatorLeRobotCalibrationFileSyncResult = {
  path: string;
  exists: boolean;
  mtimeNs: number;
  jointNames: string[];
  motorIds: number[];
  zeroPositionsRad: Record<string, number>;
  changed: boolean;
  applied: boolean;
  message: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toTrimmedString = (value: unknown, defaultValue = ""): string =>
  typeof value === "string" ? value.trim() || defaultValue : defaultValue;

const toFiniteNumber = (value: unknown, defaultValue: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : defaultValue;

const toOptionalFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toBoolean = (value: unknown): boolean => value === true;

const readField = (
  value: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): unknown => value[camelKey] ?? value[snakeKey];

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

const toNumberRecord = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        Boolean(entry[0].trim()) &&
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1]),
    ),
  );
};

const toNullableFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toNullableInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const toGatewayJointTelemetryRecord = (
  value: unknown,
): Record<string, OperatorGatewayJointTelemetry> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([jointName, rawTelemetry]) => {
      if (!jointName.trim() || !isRecord(rawTelemetry)) return [];
      const positionRad = toFiniteNumber(
        readField(rawTelemetry, "positionRad", "position_rad"),
        Number.NaN,
      );
      if (!Number.isFinite(positionRad)) return [];
      return [
        [
          jointName,
          {
            positionRad,
            velocityRadPerSec: toNullableFiniteNumber(
              readField(rawTelemetry, "velocityRadPerSec", "velocity_rad_per_sec"),
            ),
            torqueNm: toNullableFiniteNumber(
              readField(rawTelemetry, "torqueNm", "torque_nm"),
            ),
            tempMosC: toNullableFiniteNumber(
              readField(rawTelemetry, "tempMosC", "temp_mos_c"),
            ),
            tempRotorC: toNullableFiniteNumber(
              readField(rawTelemetry, "tempRotorC", "temp_rotor_c"),
            ),
            faultCode: toNullableInteger(
              readField(rawTelemetry, "faultCode", "fault_code"),
            ),
          },
        ],
      ];
    }),
  );
};

const toNumberTuple3Array = (value: unknown): [number, number, number][] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is [number, number, number] =>
          Array.isArray(entry) &&
          entry.length === OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS &&
          entry.every(
            (component) =>
              typeof component === "number" && Number.isFinite(component),
          ),
      )
    : [];

const toNumberTuple3 = (value: unknown): [number, number, number] | null =>
  Array.isArray(value) &&
  value.length === OPERATOR_POINT_CLOUD_COORDINATE_COMPONENTS &&
  value.every(
    (component) => typeof component === "number" && Number.isFinite(component),
  )
    ? (value as [number, number, number])
    : null;

const normalizeCameraIntrinsics = (
  value: unknown,
): OperatorCameraIntrinsics => {
  const intrinsics = isRecord(value) ? value : {};
  return {
    width: toFiniteNumber(intrinsics.width, 0),
    height: toFiniteNumber(intrinsics.height, 0),
    fx: toFiniteNumber(intrinsics.fx, 0),
    fy: toFiniteNumber(intrinsics.fy, 0),
    ppx: toFiniteNumber(intrinsics.ppx, 0),
    ppy: toFiniteNumber(intrinsics.ppy, 0),
  };
};

const normalizeCameraCoordinateFrame = (
  value: unknown,
): OperatorCameraStream["coordinateFrame"] => {
  const coordinateFrame = toTrimmedString(value);
  return coordinateFrame === "camera" ? "camera" : "robot_world";
};

const normalizePointCloudWorldFrame = (
  value: unknown,
): NonNullable<OperatorPointCloudFrame["cameraPose"]>["worldFrame"] => {
  const worldFrame = toTrimmedString(value);
  return worldFrame === "hf_y_up" ? "hf_y_up" : "urdf_z_up";
};

const normalizeCameraKind = (value: unknown): OperatorCameraStream["kind"] => {
  const kind = toTrimmedString(value);
  if (kind === "rgb" || kind === "depth" || kind === "rgbd") return kind;
  return "rgbd";
};

const normalizeCameraPose = (value: unknown): OperatorCameraPose | undefined => {
  if (!isRecord(value)) return undefined;
  const position = toNumberTuple3(value.position);
  const rotationRpyDeg = toNumberTuple3(
    readField(value, "rotationRpyDeg", "rotation_rpy_deg"),
  );
  const gravity = toNumberTuple3(value.gravity);
  const scale = toOptionalFiniteNumber(value.scale);
  if (!position || !rotationRpyDeg || scale === null) return undefined;
  return {
    position,
    rotationRpyDeg,
    scale,
    worldFrame: normalizePointCloudWorldFrame(
      readField(value, "worldFrame", "world_frame"),
    ),
    gravity: gravity ?? undefined,
    useGravityOrientation: toBoolean(
      readField(value, "useGravityOrientation", "use_gravity_orientation"),
    ),
  };
};

const normalizeCameraStream = (value: unknown): OperatorCameraStream => {
  if (!isRecord(value)) {
    throw new Error("Teleop provider camera stream payload must be an object.");
  }
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  return {
    id: toTrimmedString(value.id),
    label: toTrimmedString(value.label),
    kind: normalizeCameraKind(value.kind),
    frameId: toTrimmedString(readField(value, "frameId", "frame_id")),
    coordinateFrame: normalizeCameraCoordinateFrame(
      readField(value, "coordinateFrame", "coordinate_frame"),
    ),
    intrinsics: normalizeCameraIntrinsics(value.intrinsics),
    capabilities: {
      color: toBoolean(capabilities.color),
      depth: toBoolean(capabilities.depth),
      pointCloud: toBoolean(
        readField(capabilities, "pointCloud", "point_cloud"),
      ),
    },
    colorStreamPath:
      toTrimmedString(
        readField(value, "colorStreamPath", "color_stream_path"),
      ) || undefined,
    depthStreamPath:
      toTrimmedString(
        readField(value, "depthStreamPath", "depth_stream_path"),
      ) || undefined,
    metadataStreamPath:
      toTrimmedString(
        readField(value, "metadataStreamPath", "metadata_stream_path"),
      ) || undefined,
    pointCloudPath:
      toTrimmedString(readField(value, "pointCloudPath", "point_cloud_path")) ||
      undefined,
    cameraPose: normalizeCameraPose(readField(value, "cameraPose", "camera_pose")),
  };
};

const normalizeRobotFamily = (
  value: unknown,
): OperatorTeleopProfile["robotFamily"] => {
  const robotFamily = toTrimmedString(value);
  switch (robotFamily) {
    case "mobile_base":
    case "mobile_manipulator":
    case "manipulator":
      return robotFamily;
    default:
      return "manipulator";
  }
};

const normalizeControlTargetSide = (
  value: unknown,
): OperatorTeleopProfile["controlTargetSide"] => {
  const side = toTrimmedString(value);
  switch (side) {
    case "left":
    case "right":
    case "both":
    case "center":
      return side;
    default:
      return null;
  }
};

const normalizeControlInputKind = (
  value: unknown,
): OperatorTeleopControlInputKind => {
  const kind = toTrimmedString(value);
  switch (kind) {
    case "keyboard":
    case "joystick":
    case "leader_arm":
    case "spacemouse":
    case "policy":
    case "custom":
      return kind;
    default:
      return "custom";
  }
};

const normalizeControlInput = (value: unknown): OperatorTeleopControlInput => {
  if (!isRecord(value)) {
    throw new Error("Teleop control input payload must be an object.");
  }
  const kind = normalizeControlInputKind(value.kind);
  return {
    id: toTrimmedString(value.id),
    kind,
    label: toTrimmedString(value.label, kind),
    summary: toTrimmedString(value.summary),
  };
};

const normalizeProviderConnectionMode = (
  value: unknown,
): OperatorProviderConnectionMode => {
  if (!isRecord(value)) {
    throw new Error(
      "Teleop provider connection mode payload must be an object.",
    );
  }
  return {
    id: toTrimmedString(value.id),
    label: toTrimmedString(value.label),
    summary: toTrimmedString(value.summary),
    maxOperatorRttMs: toOptionalFiniteNumber(
      readField(value, "maxOperatorRttMs", "max_operator_rtt_ms"),
    ),
    configRef:
      toTrimmedString(readField(value, "configRef", "config_ref")) || null,
  };
};

const normalizeProviderCapabilities = (
  value: unknown,
): OperatorProviderCapabilitySet => {
  const capabilities = isRecord(value) ? value : {};
  return {
    observe: toBoolean(capabilities.observe),
    telemetry: toBoolean(capabilities.telemetry),
    video: toBoolean(capabilities.video),
    record: toBoolean(capabilities.record),
    control: toBoolean(capabilities.control),
    estop: toBoolean(capabilities.estop),
  };
};

const normalizeProviderProfile = (value: unknown): OperatorTeleopProfile => {
  if (!isRecord(value)) {
    throw new Error("Teleop provider profile payload must be an object.");
  }
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  const topics = isRecord(value.topics) ? value.topics : {};
  const limits = isRecord(value.limits) ? value.limits : {};
  const transport = toTrimmedString(value.transport);
  if (transport !== "robot_gateway") {
    throw new Error(
      `Unsupported teleop provider transport: ${transport || "missing"}`,
    );
  }
  return {
    id: toTrimmedString(value.id),
    label: toTrimmedString(value.label),
    summary: toTrimmedString(value.summary),
    controlTargetLabel: toTrimmedString(
      readField(value, "controlTargetLabel", "control_target_label"),
    ),
    controlTargetSide: normalizeControlTargetSide(
      readField(value, "controlTargetSide", "control_target_side"),
    ),
    transport,
    capabilities: {
      baseTwist: toBoolean(readField(capabilities, "baseTwist", "base_twist")),
      lateralStrafe: toBoolean(
        readField(capabilities, "lateralStrafe", "lateral_strafe"),
      ),
      armJointState: toBoolean(
        readField(capabilities, "armJointState", "arm_joint_state"),
      ),
      armJointCommand: toBoolean(
        readField(capabilities, "armJointCommand", "arm_joint_command"),
      ),
      stateMirroring: toBoolean(
        readField(capabilities, "stateMirroring", "state_mirroring"),
      ),
      jointJog: toBoolean(readField(capabilities, "jointJog", "joint_jog")),
      gripper: toBoolean(capabilities.gripper),
      targetPoseIk: toBoolean(
        readField(capabilities, "targetPoseIk", "target_pose_ik"),
      ),
    },
    topics: {
      twist: toTrimmedString(topics.twist) || undefined,
      odom: toTrimmedString(topics.odom) || undefined,
      jointStates: toStringArray(
        readField(topics, "jointStates", "joint_states"),
      ),
      battery: toTrimmedString(topics.battery) || undefined,
      armCommand:
        toTrimmedString(readField(topics, "armCommand", "arm_command")) ||
        undefined,
      gotoJointService:
        toTrimmedString(
          readField(topics, "gotoJointService", "goto_joint_service"),
        ) || undefined,
      jointJog:
        toTrimmedString(readField(topics, "jointJog", "joint_jog")) ||
        undefined,
      robotState:
        toTrimmedString(readField(topics, "robotState", "robot_state")) ||
        undefined,
    },
    limits: {
      maxLinearSpeedMps: toFiniteNumber(
        readField(limits, "maxLinearSpeedMps", "max_linear_speed_mps"),
        0,
      ),
      maxYawSpeedRps: toFiniteNumber(
        readField(limits, "maxYawSpeedRps", "max_yaw_speed_rps"),
        0,
      ),
      commandTickMs: toFiniteNumber(
        readField(limits, "commandTickMs", "command_tick_ms"),
        0,
      ),
      deadmanTimeoutMs: toFiniteNumber(
        readField(limits, "deadmanTimeoutMs", "deadman_timeout_ms"),
        0,
      ),
      maxJointJogDeltaRad: toFiniteNumber(
        readField(limits, "maxJointJogDeltaRad", "max_joint_jog_delta_rad"),
        0,
      ),
      defaultJointJogStepRad: toFiniteNumber(
        readField(
          limits,
          "defaultJointJogStepRad",
          "default_joint_jog_step_rad",
        ),
        0,
      ),
      maxJointVelocityRadPerSec: toFiniteNumber(
        readField(
          limits,
          "maxJointVelocityRadPerSec",
          "max_joint_velocity_rad_per_s",
        ),
        0,
      ),
    },
    robotFamily: normalizeRobotFamily(
      readField(value, "robotFamily", "robot_family"),
    ),
    robotId: toTrimmedString(readField(value, "robotId", "robot_id")),
    adapterId: toTrimmedString(readField(value, "adapterId", "adapter_id")),
    teleoperationMode: resolveOperatorTeleoperationMode(
      readField(value, "teleoperationMode", "teleoperation_mode"),
      toTrimmedString(readField(value, "adapterId", "adapter_id")),
    ),
    hardwareDeviceKey: toTrimmedString(
      readField(value, "hardwareDeviceKey", "hardware_device_key") ??
        value.device_key,
    ),
    hardwareDeviceKeys: toStringArray(
      readField(value, "hardwareDeviceKeys", "hardware_device_keys"),
    ),
    controlledJointNames: toStringArray(
      readField(value, "controlledJointNames", "controlled_joint_names"),
    ),
    controlInputs: Array.isArray(
      readField(value, "controlInputs", "control_inputs"),
    )
      ? (
          readField(value, "controlInputs", "control_inputs") as unknown[]
        ).map(normalizeControlInput)
      : [],
  };
};

const isUsableProviderProfile = (profile: OperatorTeleopProfile): boolean =>
  Boolean(profile.id && profile.label) &&
  ((profile.capabilities.baseTwist &&
    profile.limits.maxLinearSpeedMps > 0 &&
    profile.limits.commandTickMs > 0) ||
    (profile.capabilities.jointJog &&
      profile.limits.maxJointJogDeltaRad > 0 &&
      profile.controlledJointNames.length > 0) ||
    profile.capabilities.stateMirroring);

export const normalizeOperatorProviderManifest = (
  value: unknown,
): OperatorProviderManifest => {
  if (!isRecord(value)) {
    throw new Error("Teleop provider manifest payload must be an object.");
  }
  const profiles = Array.isArray(value.profiles)
    ? value.profiles.map(normalizeProviderProfile)
    : [];
  const cameraStreams = Array.isArray(
    readField(value, "cameraStreams", "camera_streams"),
  )
    ? (readField(value, "cameraStreams", "camera_streams") as unknown[]).map(
        normalizeCameraStream,
      )
    : [];
  return {
    contractVersion: toTrimmedString(
      readField(value, "contractVersion", "contract_version"),
    ),
    providerId: toTrimmedString(readField(value, "providerId", "provider_id")),
    providerDisplayName: toTrimmedString(
      readField(value, "providerDisplayName", "provider_display_name"),
    ),
    connectionModes: Array.isArray(
      readField(value, "connectionModes", "connection_modes"),
    )
      ? (
          readField(value, "connectionModes", "connection_modes") as unknown[]
        ).map(normalizeProviderConnectionMode)
      : [],
    capabilities: normalizeProviderCapabilities(value.capabilities),
    profiles: profiles.filter(isUsableProviderProfile),
    cameraStreams: cameraStreams.filter(
      (stream) =>
        Boolean(stream.id && stream.label && stream.capabilities.pointCloud) &&
        stream.intrinsics.width > 0 &&
        stream.intrinsics.height > 0,
    ),
    liveTransport: normalizeLiveTransportDescriptor(
      readField(value, "liveTransport", "live_transport"),
    ),
    controlTransport: normalizeOperatorControlTransportDescriptor(
      readField(value, "controlTransport", "control_transport"),
    ),
  };
};

const normalizePointCloudFrame = (value: unknown): OperatorPointCloudFrame => {
  if (!isRecord(value)) {
    throw new Error("Teleop point-cloud frame payload must be an object.");
  }
  const cameraPose = normalizeCameraPose(readField(value, "cameraPose", "camera_pose"));
  return {
    cameraId: toTrimmedString(readField(value, "cameraId", "camera_id")),
    frameId: toTrimmedString(readField(value, "frameId", "frame_id")),
    coordinateFrame: normalizeCameraCoordinateFrame(
      readField(value, "coordinateFrame", "coordinate_frame"),
    ),
    sequence: toFiniteNumber(value.sequence, 0),
    sourceTsMs: toFiniteNumber(
      readField(value, "sourceTsMs", "source_ts_ms"),
      0,
    ),
    intrinsics: normalizeCameraIntrinsics(value.intrinsics),
    pointsXyz: toNumberTuple3Array(readField(value, "pointsXyz", "points_xyz")),
    colorsRgb: toNumberTuple3Array(readField(value, "colorsRgb", "colors_rgb")),
    cameraPose,
  };
};

const normalizeOperatorControlMode = (value: unknown): OperatorControlMode => {
  const mode = toTrimmedString(value);
  if (mode === "shared_autonomy" || mode === "safe_hold") return mode;
  return "manual";
};

const normalizeGatewayStateFrame = (
  value: unknown,
): OperatorGatewayStateFrame => {
  if (!isRecord(value)) {
    throw new Error("Teleop gateway state payload must be an object.");
  }
  const safetyValue = readField(
    value,
    "hardwareMotionSafety",
    "hardware_motion_safety",
  );
  return {
    robotId: toTrimmedString(readField(value, "robotId", "robot_id")),
    adapterId: toTrimmedString(readField(value, "adapterId", "adapter_id")),
    profileId: toTrimmedString(readField(value, "profileId", "profile_id")),
    sequence: toFiniteNumber(value.sequence, 0),
    sourceTsMs: toFiniteNumber(
      readField(value, "sourceTsMs", "source_ts_ms"),
      0,
    ),
    mode: normalizeOperatorControlMode(value.mode),
    estop: toBoolean(value.estop),
    heartbeatOk: toBoolean(readField(value, "heartbeatOk", "heartbeat_ok")),
    jointPositionsRad: toNumberRecord(
      readField(value, "jointPositionsRad", "joint_positions_rad"),
    ),
    gripperPositionsRad: toNumberRecord(
      readField(value, "gripperPositionsRad", "gripper_positions_rad"),
    ),
    jointTelemetry: toGatewayJointTelemetryRecord(
      readField(value, "jointTelemetry", "joint_telemetry"),
    ),
    hardwareMotionSafety: normalizeHardwareMotionSafetyStatus(safetyValue),
  };
};

const normalizeHardwareMotionSafetyStatus = (
  value: unknown,
): OperatorHardwareMotionSafetyStatus => {
  if (!isRecord(value)) {
    return {
      motionReady: false,
      authoritativeJointFeedbackReady: false,
      jointRotationCalibrationReady: false,
      jointRotationCalibrationRequired: false,
      jointRotationCalibrationId: null,
      selfCollisionPreflightReady: false,
      gripperMotionEnabled: false,
      lastRejectReason: null,
    };
  }
  return {
    motionReady: toBoolean(readField(value, "motionReady", "motion_ready")),
    authoritativeJointFeedbackReady: toBoolean(
      readField(
        value,
        "authoritativeJointFeedbackReady",
        "authoritative_joint_feedback_ready",
      ),
    ),
    jointRotationCalibrationReady: toBoolean(
      readField(
        value,
        "jointRotationCalibrationReady",
        "joint_rotation_calibration_ready",
      ),
    ),
    jointRotationCalibrationRequired: toBoolean(
      readField(
        value,
        "jointRotationCalibrationRequired",
        "joint_rotation_calibration_required",
      ),
    ),
    jointRotationCalibrationId:
      toTrimmedString(
        readField(
          value,
          "jointRotationCalibrationId",
          "joint_rotation_calibration_id",
        ),
      ) || null,
    selfCollisionPreflightReady: toBoolean(
      readField(
        value,
        "selfCollisionPreflightReady",
        "self_collision_preflight_ready",
      ),
    ),
    gripperMotionEnabled: toBoolean(
      readField(value, "gripperMotionEnabled", "gripper_motion_enabled"),
    ),
    lastRejectReason:
      toTrimmedString(readField(value, "lastRejectReason", "last_reject_reason")) ||
      null,
  };
};

const normalizeOpenArmLeaderSource = (
  value: unknown,
): OperatorOpenArmLeaderDevice["source"] => {
  const source = toTrimmedString(value);
  return source === "serial_by_id" ? "serial_by_id" : "tty_glob";
};

const normalizeOpenArmLeaderType = (
  value: unknown,
): OperatorOpenArmLeaderDevice["leaderType"] => {
  const leaderType = toTrimmedString(value);
  return leaderType === "serial_candidate"
    ? "serial_candidate"
    : "serial_leader_candidate";
};

const normalizeOpenArmLeaderHardwareFamily = (
  value: unknown,
): OperatorOpenArmLeaderDevice["hardwareFamily"] => {
  const hardwareFamily = toTrimmedString(value);
  if (
    hardwareFamily === "arm_controller" ||
    hardwareFamily === "motor_chain"
  ) {
    return hardwareFamily;
  }
  return "serial_unknown";
};

const toIntegerArray = (value: unknown): number[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is number => Number.isInteger(entry))
        .sort((left, right) => left - right)
    : [];

const toOrderedIntegerArray = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is number => Number.isInteger(entry))
    : [];

const toPositiveIntegerOrNull = (value: unknown): number | null =>
  Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;

const toMotorModelRecord = (value: unknown): Record<number, string> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([rawMotorId, rawModel]) => {
      const motorId = Number(rawMotorId);
      const model = toTrimmedString(rawModel);
      return Number.isInteger(motorId) && motorId > 0 && model
        ? [[motorId, model]]
        : [];
    }),
  );
};

const normalizeLeaderControlPartKind = (
  value: unknown,
): OperatorLeaderControlPart["kind"] =>
  toTrimmedString(value) === "arm" ? "arm" : "unknown";

const normalizeLeaderControlPart = (
  value: unknown,
): OperatorLeaderControlPart | null => {
  if (!isRecord(value)) return null;
  const id = toTrimmedString(value.id);
  const label = toTrimmedString(value.label);
  if (!id || !label) return null;
  return {
    id,
    kind: normalizeLeaderControlPartKind(value.kind),
    label,
    actuatorCount: Math.max(
      0,
      toFiniteNumber(readField(value, "actuatorCount", "actuator_count"), 0),
    ),
    motorBus: toTrimmedString(readField(value, "motorBus", "motor_bus")) || null,
    motorIds: toIntegerArray(readField(value, "motorIds", "motor_ids")),
    motorModel:
      toTrimmedString(readField(value, "motorModel", "motor_model")) || null,
    motorModels: toMotorModelRecord(
      readField(value, "motorModels", "motor_models"),
    ),
    jointNames: toStringArray(readField(value, "jointNames", "joint_names")),
    zeroPositionsRad: toNumberRecord(
      readField(value, "zeroPositionsRad", "zero_positions_rad"),
    ),
    calibrationCategory:
      toTrimmedString(
        readField(value, "calibrationCategory", "calibration_category"),
      ) || null,
    calibrationProfile:
      toTrimmedString(
        readField(value, "calibrationProfile", "calibration_profile"),
      ) || null,
    calibrationId:
      toTrimmedString(readField(value, "calibrationId", "calibration_id")) ||
      null,
    calibrationGroup:
      toTrimmedString(readField(value, "calibrationGroup", "calibration_group")) ||
      null,
    configuredPort:
      toTrimmedString(readField(value, "configuredPort", "configured_port")) ||
      null,
    configuredPortMatches: toBoolean(
      readField(value, "configuredPortMatches", "configured_port_matches"),
    ),
    configuredPortStatus: normalizeConfiguredPortStatus(
      readField(value, "configuredPortStatus", "configured_port_status"),
    ),
  };
};

const normalizeConfiguredPortStatus = (
  value: unknown,
): OperatorLeaderControlPart["configuredPortStatus"] => {
  const status = toTrimmedString(value);
  return status === "matched" || status === "stale" || status === "unmatched"
    ? status
    : "none";
};

const buildFallbackLeaderControlParts = ({
  motorBus,
  motorIds,
  motorCount,
}: {
  motorBus: string | null;
  motorIds: number[];
  motorCount: number;
}): OperatorLeaderControlPart[] => {
  if (!motorBus || motorCount < 4) return [];
  const ids = motorIds.length > 0 ? motorIds : Array.from({ length: motorCount }, (_, index) => index + 1);
  return [
    {
      id: `${motorBus}:${ids.join("-")}`,
      kind: "arm",
      label: "Arm",
      actuatorCount: motorCount,
      motorBus,
      motorIds: ids,
      motorModel: null,
      motorModels: {},
      jointNames: [],
      zeroPositionsRad: {},
      calibrationCategory: null,
      calibrationProfile: null,
      calibrationId: null,
      calibrationGroup: null,
      configuredPort: null,
      configuredPortMatches: false,
      configuredPortStatus: "none",
    },
  ];
};

const normalizeOpenArmLeaderDevice = (
  value: unknown,
): OperatorOpenArmLeaderDevice | null => {
  if (!isRecord(value)) return null;
  const path = toTrimmedString(value.path);
  const devicePath = toTrimmedString(
    readField(value, "devicePath", "device_path"),
  );
  const identityKey = toTrimmedString(
    readField(value, "identityKey", "identity_key"),
  );
  if (!path || !devicePath || !identityKey) return null;
  const motorBus = toTrimmedString(readField(value, "motorBus", "motor_bus")) || null;
  const motorIds = toIntegerArray(readField(value, "motorIds", "motor_ids"));
  const motorModels = toMotorModelRecord(
    readField(value, "motorModels", "motor_models"),
  );
  const motorCount = toFiniteNumber(
    readField(value, "motorCount", "motor_count"),
    0,
  );
  const controlParts = Array.isArray(readField(value, "controlParts", "control_parts"))
    ? (readField(value, "controlParts", "control_parts") as unknown[])
        .map(normalizeLeaderControlPart)
        .filter((part): part is OperatorLeaderControlPart => part !== null)
    : [];
  return {
    id: toTrimmedString(value.id, path),
    path,
    devicePath,
    identityKey,
    identityStable: toBoolean(readField(value, "identityStable", "identity_stable")),
    serial: toTrimmedString(value.serial) || null,
    label: toTrimmedString(value.label, path),
    source: normalizeOpenArmLeaderSource(value.source),
    leaderType: normalizeOpenArmLeaderType(
      readField(value, "leaderType", "leader_type"),
    ),
    hardwareFamily: normalizeOpenArmLeaderHardwareFamily(
      readField(value, "hardwareFamily", "hardware_family"),
    ),
    motorBus,
    motorIds,
    motorModels,
    motorCount,
    motorProbeError:
      toTrimmedString(readField(value, "motorProbeError", "motor_probe_error")) ||
      null,
    controlParts:
      controlParts.length > 0
        ? controlParts
        : buildFallbackLeaderControlParts({ motorBus, motorIds, motorCount }),
    recommendedEnv: toTrimmedString(
      readField(value, "recommendedEnv", "recommended_env"),
    ),
    available: toBoolean(value.available),
  };
};

const normalizeRuntimeProvider = (
  value: unknown,
): OperatorRuntimeProvider | null => {
  if (!isRecord(value)) return null;
  const id = toTrimmedString(value.id);
  const label = toTrimmedString(value.label);
  if (!id || !label) return null;
  const kind = toTrimmedString(value.kind);
  const status = toTrimmedString(value.status);
  return {
    id,
    label,
    kind: kind === "dataflow" ? "dataflow" : "hardware",
    status:
      status === "needs_config" || status === "missing"
        ? status
        : "available",
    connectable: toBoolean(value.connectable),
    summary: toTrimmedString(value.summary),
    configRef:
      toTrimmedString(readField(value, "configRef", "config_ref")) || null,
    nodeId: toTrimmedString(readField(value, "nodeId", "node_id")) || null,
  };
};

const normalizeOpenArmLeaderDetection = (
  value: unknown,
): OperatorOpenArmLeaderDetection => {
  const detection = isRecord(value) ? value : {};
  const leaders = Array.isArray(detection.leaders)
    ? detection.leaders
        .map(normalizeOpenArmLeaderDevice)
        .filter((leader): leader is OperatorOpenArmLeaderDevice =>
          Boolean(leader),
        )
    : [];
  return {
    leaders,
    runtimeProviders: Array.isArray(
      readField(detection, "runtimeProviders", "runtime_providers"),
    )
      ? (
          readField(
            detection,
            "runtimeProviders",
            "runtime_providers",
          ) as unknown[]
        )
          .map(normalizeRuntimeProvider)
          .filter((provider): provider is OperatorRuntimeProvider =>
            Boolean(provider),
          )
      : [],
    preferredLeaderPort:
      toTrimmedString(
        readField(
          detection,
          "preferredLeaderPort",
          "preferred_leader_port",
        ),
      ) ||
      null,
  };
};

const normalizeOpenArmLeaderStateSide = (
  value: unknown,
): OperatorOpenArmLeaderStateSide => {
  const side = toTrimmedString(value);
  return side === "left" || side === "right" ? side : "both";
};

const normalizeOpenArmLeaderJointTelemetry = (
  value: unknown,
): OperatorOpenArmLeaderJointTelemetry | null => {
  if (!isRecord(value)) return null;
  const positionRad = toFiniteNumber(
    readField(value, "positionRad", "position_rad"),
    Number.NaN,
  );
  if (!Number.isFinite(positionRad)) return null;
  const motorId = toPositiveIntegerOrNull(readField(value, "motorId", "motor_id"));
  return {
    positionRad,
    velocityRadPerSec: toFiniteNumber(
      readField(value, "velocityRadPerSec", "velocity_rad_per_sec"),
      Number.NaN,
    ),
    torqueNm: toFiniteNumber(
      readField(value, "torqueNm", "torque_nm"),
      Number.NaN,
    ),
    ...(motorId === null ? {} : { motorId }),
  };
};

const normalizeOpenArmLeaderState = (
  value: unknown,
): OperatorOpenArmLeaderState => {
  const state = isRecord(value) ? value : {};
  const jointsRaw = readField(state, "joints", "joints");
  const joints: Record<string, OperatorOpenArmLeaderJointTelemetry> = {};
  if (isRecord(jointsRaw)) {
    Object.entries(jointsRaw).forEach(([jointName, telemetryRaw]) => {
      const telemetry = normalizeOpenArmLeaderJointTelemetry(telemetryRaw);
      if (telemetry) {
        joints[jointName] = telemetry;
      }
    });
  }
  return {
    connected: toBoolean(state.connected),
    port: toTrimmedString(state.port),
    side: normalizeOpenArmLeaderStateSide(state.side),
    sourceTsMs: toFiniteNumber(
      readField(state, "sourceTsMs", "source_ts_ms"),
      0,
    ),
    joints,
    error: toTrimmedString(state.error) || null,
  };
};

const normalizeOperatorGatewayEnvConfigFile = (
  value: unknown,
): OperatorGatewayEnvConfigFile => {
  const config = isRecord(value) ? value : {};
  return {
    path: toTrimmedString(config.path),
    content: typeof config.content === "string" ? config.content : "",
    exists: toBoolean(config.exists),
  };
};

const normalizeOperatorGatewayEnvConfigOpenResult = (
  value: unknown,
): OperatorGatewayEnvConfigOpenResult => {
  const result = isRecord(value) ? value : {};
  return {
    path: toTrimmedString(result.path),
    exists: toBoolean(result.exists),
    opened: toBoolean(result.opened),
    message: toTrimmedString(result.message),
  };
};

const normalizeOperatorLeRobotCalibrationStartResult = (
  value: unknown,
): OperatorLeRobotCalibrationStartResult => {
  const result = isRecord(value) ? value : {};
  return {
    started: toBoolean(result.started),
    command: toStringArray(result.command),
    displayCommand: toTrimmedString(
      readField(result, "displayCommand", "display_command"),
    ),
    message: toTrimmedString(result.message),
  };
};

const normalizeOperatorLeRobotCalibrationCatalogEntry = (
  value: unknown,
): OperatorLeRobotCalibrationCatalogEntry | null => {
  if (!isRecord(value)) return null;
  const source = normalizeOperatorLeRobotCalibrationSource(value);
  if (source === null) return null;
  const id = toTrimmedString(value.id);
  if (!id) return null;
  return {
    id,
    ...source,
    path: toTrimmedString(value.path),
    jointNames: toStringArray(readField(value, "jointNames", "joint_names")),
    motorIds: toIntegerArray(readField(value, "motorIds", "motor_ids")),
    zeroPositionsRad: toNumberRecord(
      readField(value, "zeroPositionsRad", "zero_positions_rad"),
    ),
    actuatorCount: Math.max(
      0,
      toFiniteNumber(readField(value, "actuatorCount", "actuator_count"), 0),
    ),
  };
};

const normalizeOperatorLeRobotCalibrationSource = (
  value: unknown,
): OperatorLeRobotCalibrationSource | null => {
  if (!isRecord(value)) return null;
  const category = toTrimmedString(value.category);
  const profileId = toTrimmedString(readField(value, "profileId", "profile_id"));
  const calibrationId = toTrimmedString(
    readField(value, "calibrationId", "calibration_id"),
  );
  const calibrationDir = toTrimmedString(
    readField(value, "calibrationDir", "calibration_dir"),
  );
  if (!category || !profileId || !calibrationId || !calibrationDir) {
    return null;
  }
  return {
    category,
    profileId,
    calibrationId,
    calibrationDir,
    groupId:
      toTrimmedString(readField(value, "groupId", "group_id")) || "all",
  };
};

const normalizeOperatorLeRobotCalibrationCatalog = (
  value: unknown,
): OperatorLeRobotCalibrationCatalog => {
  const catalog = isRecord(value) ? value : {};
  const rawEntries = Array.isArray(catalog.entries) ? catalog.entries : [];
  return {
    activeSource: normalizeOperatorLeRobotCalibrationSource(
      readField(catalog, "activeSource", "active_source"),
    ),
    entries: rawEntries.flatMap((entry) => {
      const normalized = normalizeOperatorLeRobotCalibrationCatalogEntry(entry);
      return normalized ? [normalized] : [];
    }),
  };
};

const normalizeOperatorLeRobotCalibrationFileSyncResult = (
  value: unknown,
): OperatorLeRobotCalibrationFileSyncResult => {
  const result = isRecord(value) ? value : {};
  return {
    path: toTrimmedString(result.path),
    exists: toBoolean(result.exists),
    mtimeNs: Math.max(
      0,
      toFiniteNumber(readField(result, "mtimeNs", "mtime_ns"), 0),
    ),
    jointNames: toStringArray(readField(result, "jointNames", "joint_names")),
    motorIds: toOrderedIntegerArray(readField(result, "motorIds", "motor_ids")),
    zeroPositionsRad: toNumberRecord(
      readField(result, "zeroPositionsRad", "zero_positions_rad"),
    ),
    changed: toBoolean(result.changed),
    applied: toBoolean(result.applied),
    message: toTrimmedString(result.message),
  };
};

class OperatorHttpError extends Error {
  readonly status: number;

  constructor(context: string, status: number) {
    super(`${context} failed: ${status}`);
    this.status = status;
  }
}

export const parseOperatorJson = async <T>(
  response: Response,
  context: string,
): Promise<T> => {
  if (!response.ok) {
    throw new OperatorHttpError(context, response.status);
  }
  return (await response.json()) as T;
};

const fetchOperatorJson = async <T>(
  baseUrl: string,
  path: string,
  context: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, init);
  return parseOperatorJson<T>(response, context);
};

export const buildOperatorAuthorizationHeaders = (
  browserToken: string,
  authorization?: OperatorCollaborationAuthorization | null,
  baseHeaders?: HeadersInit,
): Headers => {
  const headers = new Headers(baseHeaders);
  if (browserToken) {
    headers.set("X-Operator-Helper-Token", browserToken);
  }
  if (authorization) {
    headers.set(
      OPERATOR_HELPER_COLLABORATION_SESSION_HEADER,
      authorization.sessionId,
    );
    if (authorization.teleopCapabilityToken) {
      headers.set(
        OPERATOR_HELPER_COLLABORATION_TELEOP_CAPABILITY_HEADER,
        authorization.teleopCapabilityToken,
      );
    }
    if (authorization.ownerToken) {
      headers.set(COLLABORATION_SESSION_TOKEN_HEADER, authorization.ownerToken);
    }
  }
  return headers;
};

export const fetchOperatorProviderManifest = async (
  baseUrl = OPERATOR_HELPER_BASE_URL,
  authorization?: OperatorCollaborationAuthorization | null,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
): Promise<OperatorProviderManifest> => {
  const authorizedResponse = await fetch(
    `${baseUrl}${OPERATOR_HELPER_AUTHORIZED_PROVIDER_MANIFEST_PATH}`,
    {
      headers: buildOperatorAuthorizationHeaders(browserToken, authorization),
    },
  );
  if (authorizedResponse.ok) {
    return normalizeOperatorProviderManifest(
      await authorizedResponse.json(),
    );
  }
  if (
    ![401, 403, 404].includes(authorizedResponse.status)
  ) {
    await parseOperatorJson<unknown>(
      authorizedResponse,
      "Authorized teleop provider manifest",
    );
  }

  return normalizeOperatorProviderManifest(
    await fetchOperatorJson<unknown>(
      baseUrl,
      OPERATOR_HELPER_PROVIDER_MANIFEST_PATH,
      "Teleop provider manifest",
    ),
  );
};

export const fetchOperatorGatewayEnvConfig = async (
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
): Promise<OperatorGatewayEnvConfigFile> =>
  normalizeOperatorGatewayEnvConfigFile(
    await fetchOperatorJson<unknown>(
      baseUrl,
      OPERATOR_HELPER_ENV_CONFIG_PATH,
      "Robot gateway env config",
    ),
  );

export const saveOperatorGatewayEnvConfig = async (
  content: string,
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
): Promise<OperatorGatewayEnvConfigFile> => {
  const response = await fetch(`${baseUrl}${OPERATOR_HELPER_ENV_CONFIG_PATH}`, {
    method: "PUT",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ content }),
  });
  return normalizeOperatorGatewayEnvConfigFile(
    await parseOperatorJson<unknown>(response, "Robot gateway env config save"),
  );
};

export const openOperatorGatewayEnvConfigFile = async (
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
): Promise<OperatorGatewayEnvConfigOpenResult> => {
  const response = await fetch(`${baseUrl}${OPERATOR_HELPER_ENV_CONFIG_PATH}/open`, {
    method: "POST",
  });
  return normalizeOperatorGatewayEnvConfigOpenResult(
    await parseOperatorJson<unknown>(response, "Robot gateway env config open"),
  );
};

export const fetchOperatorLeaderDetection = async (
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
): Promise<OperatorLeaderDetection> =>
  normalizeOpenArmLeaderDetection(
    await fetchOperatorJson<unknown>(
      baseUrl,
      OPERATOR_HELPER_LEADER_DETECTION_PATH,
      "Leader detection",
    ),
  );

export const fetchOperatorLeRobotCalibrationCatalog = async (
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
): Promise<OperatorLeRobotCalibrationCatalog> =>
  normalizeOperatorLeRobotCalibrationCatalog(
    await fetchOperatorJson<unknown>(
      baseUrl,
      OPERATOR_HELPER_LEROBOT_CALIBRATIONS_PATH,
      "LeRobot calibration catalog",
    ),
  );

export const openOperatorLeRobotCalibrationFile = async (
  calibrationSource: OperatorLeRobotCalibrationSource,
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
): Promise<OperatorGatewayEnvConfigOpenResult> => {
  const response = await fetch(
    `${baseUrl}${OPERATOR_HELPER_LEROBOT_CALIBRATION_OPEN_PATH}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calibration_source:
          buildOperatorLeRobotCalibrationSourcePayload(calibrationSource),
      }),
    },
  );
  return normalizeOperatorGatewayEnvConfigOpenResult(
    await parseOperatorJson<unknown>(response, "LeRobot calibration file open"),
  );
};

export const syncOperatorLeRobotCalibrationFile = async (
  request: OperatorLeRobotCalibrationFileSyncRequest,
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
): Promise<OperatorLeRobotCalibrationFileSyncResult> => {
  const response = await fetch(
    `${baseUrl}${OPERATOR_HELPER_LEROBOT_CALIBRATION_SYNC_PATH}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: request.role,
        calibration_source: buildOperatorLeRobotCalibrationSourcePayload(
          request.calibrationSource,
        ),
        ...(request.lastMtimeNs !== null && request.lastMtimeNs !== undefined
          ? { last_mtime_ns: request.lastMtimeNs }
          : {}),
        ...(request.leaderPort?.trim()
          ? { leader_port: request.leaderPort.trim() }
          : {}),
        ...(request.leaderMotorIds && request.leaderMotorIds.length > 0
          ? { leader_motor_ids: request.leaderMotorIds }
          : {}),
        ...(request.leaderMotorModel?.trim()
          ? { leader_motor_model: request.leaderMotorModel.trim() }
          : {}),
      }),
    },
  );
  return normalizeOperatorLeRobotCalibrationFileSyncResult(
    await parseOperatorJson<unknown>(response, "LeRobot calibration file sync"),
  );
};

export const fetchOperatorLeaderState = async (
  port: string,
  side: OperatorLeaderStateSide = "both",
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
  options: OperatorLeaderStateOptions = {},
): Promise<OperatorLeaderState> => {
  const params = new URLSearchParams({ port, side });
  if (options.motorIds && options.motorIds.length > 0) {
    params.set("motor_ids", options.motorIds.join(","));
  }
  if (options.motorModel?.trim()) {
    params.set("motor_model", options.motorModel.trim());
  }
  if (options.calibrationCategory?.trim()) {
    params.set("calibration_category", options.calibrationCategory.trim());
  }
  if (options.calibrationProfile?.trim()) {
    params.set("calibration_profile", options.calibrationProfile.trim());
  }
  if (options.calibrationId?.trim()) {
    params.set("calibration_id", options.calibrationId.trim());
  }
  if (options.calibrationGroup?.trim()) {
    params.set("calibration_group", options.calibrationGroup.trim());
  }
  return normalizeOpenArmLeaderState(
    await fetchOperatorJson<unknown>(
      baseUrl,
      `${OPERATOR_HELPER_LEADER_STATE_PATH}?${params.toString()}`,
      "Leader state",
    ),
  );
};

export const releaseOperatorLeaderHardware = async (
  request: OperatorLeaderReleaseRequest = {},
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
): Promise<OperatorLeaderReleaseResult> => {
  const payload = buildOperatorLeaderReleasePayload(request);
  const response = await fetch(`${baseUrl}${OPERATOR_HELPER_LEADER_RELEASE_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOperatorJson<OperatorLeaderReleaseResult>(
    response,
    "Leader hardware release",
  );
};

export const releaseOperatorLeaderHardwareKeepalive = (
  request: OperatorLeaderReleaseRequest = {},
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
): void => {
  const payload = buildOperatorLeaderReleasePayload(request);
  void fetch(`${baseUrl}${OPERATOR_HELPER_LEADER_RELEASE_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
};

export const releaseOperatorFollowerHardware = async (
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): Promise<OperatorLeaderReleaseResult> =>
  postOperatorJson<OperatorLeaderReleaseResult>(
    baseUrl,
    OPERATOR_HELPER_FOLLOWER_RELEASE_PATH,
    {},
    "Follower hardware release",
    browserToken,
    authorization,
  );

export const startOperatorFollowerCalibration = async (
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
  calibrationSource?: OperatorLeRobotCalibrationSource | null,
): Promise<OperatorLeRobotCalibrationStartResult> => {
  const payload = calibrationSource
    ? {
        calibration_source: buildOperatorLeRobotCalibrationSourcePayload(
          calibrationSource,
        ),
      }
    : {};
  const response = await fetch(
    `${baseUrl}${OPERATOR_HELPER_FOLLOWER_PATHS.calibrationStart}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return normalizeOperatorLeRobotCalibrationStartResult(
    await parseOperatorJson<unknown>(response, "Follower calibration start"),
  );
};

export const startOperatorLeaderCalibration = async (
  request: OperatorLeaderReleaseRequest,
  baseUrl = OPERATOR_HELPER_LOCAL_BACKEND_BASE_URL,
): Promise<OperatorLeRobotCalibrationStartResult> => {
  const response = await fetch(
    `${baseUrl}${OPERATOR_HELPER_LEADER_PATHS.calibrationStart}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildOperatorLeaderReleasePayload(request)),
    },
  );
  return normalizeOperatorLeRobotCalibrationStartResult(
    await parseOperatorJson<unknown>(response, "Leader calibration start"),
  );
};

export const releaseOperatorFollowerHardwareKeepalive = (
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): void =>
  postOperatorJsonKeepalive(
    baseUrl,
    OPERATOR_HELPER_FOLLOWER_RELEASE_PATH,
    {},
    browserToken,
    authorization,
  );

export const buildOperatorLeaderReleasePayload = (
  request: OperatorLeaderReleaseRequest,
): Record<string, unknown> => ({
  ...(request.port?.trim() ? { port: request.port.trim() } : {}),
  ...(request.portLeft?.trim() ? { port_left: request.portLeft.trim() } : {}),
  ...(request.portRight?.trim() ? { port_right: request.portRight.trim() } : {}),
  ...(request.motorIds && request.motorIds.length > 0
    ? { motor_ids: request.motorIds }
    : {}),
  ...(request.motorModel?.trim()
    ? { motor_model: request.motorModel.trim() }
    : {}),
  ...(request.calibrationCategory?.trim()
    ? { calibration_category: request.calibrationCategory.trim() }
    : {}),
  ...(request.calibrationProfile?.trim()
    ? { calibration_profile: request.calibrationProfile.trim() }
    : {}),
  ...(request.calibrationId?.trim()
    ? { calibration_id: request.calibrationId.trim() }
    : {}),
  ...(request.calibrationGroup?.trim()
    ? { calibration_group: request.calibrationGroup.trim() }
    : {}),
});

const buildOperatorLeRobotCalibrationSourcePayload = (
  source: OperatorLeRobotCalibrationSource,
): Record<string, string> => ({
  category: source.category,
  profile_id: source.profileId,
  calibration_id: source.calibrationId,
  calibration_dir: source.calibrationDir,
  group_id: source.groupId,
});

export const postOperatorJson = async <T>(
  baseUrl: string,
  path: string,
  payload: unknown,
  context: string,
  browserToken: string,
  authorization?: OperatorCollaborationAuthorization | null,
): Promise<T> => {
  const headers = buildOperatorAuthorizationHeaders(
    browserToken,
    authorization,
    { "Content-Type": "application/json" },
  );
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await parseOperatorJson<
    T & { ok?: boolean; accepted?: boolean; error?: string; reason?: string }
  >(response, context);
  if (data.ok === false || data.accepted === false) {
    throw new Error(data.error || data.reason || `${context} failed`);
  }
  return data;
};

const postOperatorJsonKeepalive = (
  baseUrl: string,
  path: string,
  payload: unknown,
  browserToken: string,
  authorization?: OperatorCollaborationAuthorization | null,
): void => {
  const headers = buildOperatorAuthorizationHeaders(
    browserToken,
    authorization,
    { "Content-Type": "application/json" },
  );
  void fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
};

export const fetchOperatorSession = async (
  baseUrl = OPERATOR_HELPER_BASE_URL,
): Promise<OperatorSessionSnapshot> =>
  fetchOperatorJson<OperatorSessionSnapshot>(
    baseUrl,
    "/session",
    "Operator session",
  );

export const fetchOperatorStats = async (
  baseUrl = OPERATOR_HELPER_BASE_URL,
): Promise<OperatorStatsSnapshot> =>
  fetchOperatorJson<OperatorStatsSnapshot>(baseUrl, "/stats", "Operator stats");

export const fetchOperatorState = async (
  baseUrl = OPERATOR_HELPER_BASE_URL,
): Promise<OperatorGatewayStateFrame> =>
  normalizeGatewayStateFrame(
    await fetchOperatorJson<unknown>(
      baseUrl,
      OPERATOR_HELPER_TELEMETRY_STATE_PATH,
      "Operator gateway state",
    ),
  );

export const fetchOperatorPointCloud = async (
  cameraId: string,
  pointCloudPath: string | undefined,
  baseUrl = OPERATOR_HELPER_BASE_URL,
): Promise<OperatorPointCloudFrame> => {
  const path =
    pointCloudPath ||
    `/perception/cameras/${encodeURIComponent(cameraId)}${OPERATOR_HELPER_POINT_CLOUD_PATH_SUFFIX}`;
  return normalizePointCloudFrame(
    await fetchOperatorJson<unknown>(baseUrl, path, "Operator point cloud"),
  );
};

export const requestOperatorControlLease = async (
  operatorId: string,
  profileId: string,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): Promise<OperatorLeaseResponse> =>
  postOperatorJson<OperatorLeaseResponse>(
    baseUrl,
    OPERATOR_HELPER_LEASE_REQUEST_PATH,
    {
      operator_id: operatorId,
      profile_id: profileId,
    },
    "Operator control lease request",
    browserToken,
    authorization,
  );

export const releaseOperatorControlLease = async (
  operatorId: string,
  profileId: string,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): Promise<OperatorLeaseResponse> =>
  postOperatorJson<OperatorLeaseResponse>(
    baseUrl,
    OPERATOR_HELPER_LEASE_RELEASE_PATH,
    {
      operator_id: operatorId,
      profile_id: profileId,
    },
    "Operator control lease release",
    browserToken,
    authorization,
  );

export const releaseOperatorControlLeaseKeepalive = (
  operatorId: string,
  profileId: string,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): void =>
  postOperatorJsonKeepalive(
    baseUrl,
    OPERATOR_HELPER_LEASE_RELEASE_PATH,
    {
      operator_id: operatorId,
      profile_id: profileId,
    },
    browserToken,
    authorization,
  );

export const sendOperatorTwistCommand = async (
  command: OperatorTwistCommand,
  metadata: OperatorCommandMetadata,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): Promise<OperatorControlRestAck> =>
  postOperatorJson<OperatorControlRestAck>(
    baseUrl,
    OPERATOR_HELPER_TWIST_PATH,
    {
      ...command,
      ...metadata,
      ack_requested: true,
    } satisfies OperatorTwistCommandPayload,
    "Operator twist command",
    browserToken,
    authorization,
  );

export const sendOperatorStopCommand = async (
  metadata: OperatorCommandMetadata,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): Promise<OperatorControlRestAck> =>
  postOperatorJson<OperatorControlRestAck>(
    baseUrl,
    OPERATOR_HELPER_STOP_PATH,
    {
      ...metadata,
      ack_requested: true,
    },
    "Operator stop command",
    browserToken,
    authorization,
  );

export const sendOperatorStopCommandKeepalive = (
  metadata: OperatorCommandMetadata,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): void =>
  postOperatorJsonKeepalive(
    baseUrl,
    OPERATOR_HELPER_STOP_PATH,
    {
      ...metadata,
      ack_requested: true,
    },
    browserToken,
    authorization,
  );

export const sendOperatorEstopCommand = async (
  metadata: OperatorCommandMetadata,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
): Promise<OperatorControlRestAck> =>
  postOperatorJson<OperatorControlRestAck>(
    baseUrl,
    OPERATOR_HELPER_ESTOP_PATH,
    {
      ...metadata,
      ack_requested: true,
    },
    "Operator e-stop command",
    browserToken,
    authorization,
  );

export const sendOperatorJointJogCommand = async (
  command: OperatorJointJogCommand,
  metadata: OperatorCommandMetadata,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
  operatorId?: string | null,
): Promise<OperatorControlRestAck> =>
  postOperatorJson<OperatorControlRestAck>(
    baseUrl,
    OPERATOR_HELPER_JOINT_JOG_PATH,
    {
      ...command,
      ...metadata,
      command_kind: "joint_jog",
      ...(operatorId?.trim() ? { operator_id: operatorId.trim() } : {}),
      ack_requested: true,
    } satisfies OperatorJointJogCommandPayload,
    "Operator joint-jog command",
    browserToken,
    authorization,
  );

export const prepareOperatorJointJogCanDryRun = async (
  command: OperatorJointJogCommand,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  metadata: OperatorCommandMetadata = {
    command_kind: "joint_jog",
    sequence: OPERATOR_HELPER_COMMAND_SEQUENCE_INITIAL,
    source_ts_ms: Date.now(),
  },
  authorization?: OperatorCollaborationAuthorization | null,
  operatorId?: string | null,
): Promise<OperatorOpenArmCanDryRunPlan> =>
  postOperatorJson<OperatorOpenArmCanDryRunPlan>(
    baseUrl,
    OPERATOR_HELPER_JOINT_JOG_CAN_DRY_RUN_PATH,
    {
      ...command,
      ...metadata,
      command_kind: "joint_jog",
      ...(operatorId?.trim() ? { operator_id: operatorId.trim() } : {}),
      ack_requested: true,
    } satisfies OperatorJointJogCommandPayload,
    "Operator joint-jog CAN dry-run",
    browserToken,
    authorization,
  ).catch((error) => {
    if (error instanceof OperatorHttpError && error.status === 404) {
      throw new Error(
        `OpenArm CAN dry-run endpoint is unavailable. Connect a robot gateway that implements ${OPERATOR_HELPER_JOINT_JOG_CAN_DRY_RUN_PATH} before preparing CAN commands.`,
      );
    }
    throw error;
  });

export const sendOperatorOpenArmCalibrationJogCommand = async (
  command: OperatorOpenArmCalibrationJogCommand,
  metadata: OperatorCommandMetadata,
  baseUrl = OPERATOR_HELPER_BASE_URL,
  browserToken = OPERATOR_HELPER_BROWSER_TOKEN,
  authorization?: OperatorCollaborationAuthorization | null,
  operatorId?: string | null,
): Promise<OperatorControlRestAck> =>
  postOperatorJson<OperatorControlRestAck>(
    baseUrl,
    OPERATOR_HELPER_OPENARM_CALIBRATION_JOG_PATH,
    {
      ...command,
      ...metadata,
      command_kind: "openarm_calibration_jog",
      ...(operatorId?.trim() ? { operator_id: operatorId.trim() } : {}),
      ack_requested: true,
    } satisfies OperatorOpenArmCalibrationJogCommandPayload,
    "OpenArm calibration joint-jog command",
    browserToken,
    authorization,
  );
