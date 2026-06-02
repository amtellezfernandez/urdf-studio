const OPENARM_HF_LIVE_BROWSER_SECURITY_PARAMS = {
  observeOnly: true,
  browserDirectOriginEnabled: true,
  canCommandPathSegment: "commands",
  pathSeparator: "/",
  statusConnected: "OpenArm live observe connected.",
  statusWaitingForVideo: "OpenArm live observe connected; waiting for video frames.",
  statusPrivateProxyRequired: "OpenArm live observe requires a private backend proxy.",
} as const;

export const OPENARM_HF_LIVE_RELAY_URL = "https://cdn.1ms.ai";
export const OPENARM_HF_LIVE_DEFAULT_WEBSOCKET_FALLBACK_ENABLED = true;
export const OPENARM_HF_LIVE_OBSERVE_ONLY =
  OPENARM_HF_LIVE_BROWSER_SECURITY_PARAMS.observeOnly;
export const OPENARM_HF_LIVE_BROWSER_DIRECT_ORIGIN_ENABLED =
  OPENARM_HF_LIVE_BROWSER_SECURITY_PARAMS.browserDirectOriginEnabled;
export const OPENARM_HF_LIVE_SOURCE_ID = "openarm_hf_live_realsense";
export const OPENARM_HF_LIVE_CAMERA_ID = "openarm_depth_camera";
const OPENARM_HF_LIVE_CAMERA_LABEL = "OpenArm live RealSense";
export const OPENARM_HF_LIVE_CAMERA_PARENT_JOINT = "openarm_body_world_joint";
export const OPENARM_HF_LIVE_CAMERA_RPY_RAD = [0, Math.PI / 2, 0] as const;
export const OPENARM_HF_LIVE_CAMERA_FOV_DEG = 70;
export const OPENARM_HF_LIVE_CAMERA_ID_PREFIX = "openarm_hf_live_camera_";
export const OPENARM_HF_LIVE_TRACK_PRIORITY = 0;
export const OPENARM_HF_LIVE_TRACK_NAMESPACE = "";
export const OPENARM_HF_LIVE_VIDEO_TRACK_NAME = "video";
export const OPENARM_HF_LIVE_DEPTH_TRACK_NAME = "depth";
export const OPENARM_HF_LIVE_METADATA_TRACK_NAME = "metadata";
export const OPENARM_HF_LIVE_RECONNECT_DELAY_MS = 300;
export const OPENARM_HF_LIVE_WEBSOCKET_FALLBACK_DELAY_MS = 2_000;
export const OPENARM_HF_LIVE_POINT_CLOUD_FRAME_INTERVAL_MS = 33;
export const OPENARM_HF_LIVE_COLOR_CANVAS_FRAME_INTERVAL_MS = 33;
export const OPENARM_HF_LIVE_COLOR_CANVAS_STREAM_FPS = 30;
export const OPENARM_HF_LIVE_POINT_CLOUD_PIXEL_STRIDE = 1;
export const OPENARM_HF_LIVE_MSE_MAX_BUFFER_SECONDS = 4;
export const OPENARM_HF_LIVE_MSE_TARGET_LAG_SECONDS = 0.03;
export const OPENARM_HF_LIVE_MSE_SEEK_LAG_SECONDS = 0.15;
export const OPENARM_HF_LIVE_MSE_REMOVE_KEEP_SECONDS = 2;
export const OPENARM_HF_LIVE_MSE_QUEUE_KEEP_SEGMENTS = 3;
export const OPENARM_HF_LIVE_DEPTH_MIN_VALID_RAW = 2;
export const OPENARM_HF_LIVE_DEPTH_10BIT_MAX = 1_023;
export const OPENARM_HF_LIVE_DEPTH_8BIT_TO_10BIT_SCALE = 3.435;
export const OPENARM_HF_LIVE_DEPTH_8BIT_TO_10BIT_OFFSET = 64;
export const OPENARM_HF_LIVE_DEFAULT_INTRINSICS = {
  fx: 920,
  fy: 920,
  ppx: 640,
  ppy: 360,
  width: 1_280,
  height: 720,
} as const;
export const OPENARM_HF_LIVE_BAGUETTE_REALSENSE_PATH =
  "anon/7e58263812ba/realsense-243222073892";
export const OPENARM_HF_LIVE_REAL_SENSE_POSITION_M = [
  0.3, 0, 0.78,
] as const;
export const OPENARM_HF_LIVE_REAL_SENSE_ROTATION_RPY_DEG = [
  180,
  0,
  -90,
] as const;
export const OPENARM_HF_LIVE_REAL_SENSE_POSE = {
  position: [...OPENARM_HF_LIVE_REAL_SENSE_POSITION_M] as [
    number,
    number,
    number,
  ],
  rotationRpyDeg: [...OPENARM_HF_LIVE_REAL_SENSE_ROTATION_RPY_DEG] as [
    number,
    number,
    number,
  ],
  scale: 0.001,
  worldFrame: "urdf_z_up" as const,
} as const;
export type OpenArmHfLiveCameraPose = {
  position: [number, number, number];
  rotationRpyDeg: [number, number, number];
  scale: number;
  worldFrame?: "urdf_z_up" | "hf_y_up";
  gravity?: [number, number, number];
  useGravityOrientation?: boolean;
};
export type OpenArmHfLiveRealSenseTrackNames = {
  video: string;
  depth: string;
  metadata: string;
};
export type OpenArmHfLiveRealSenseSource = {
  id: string;
  cameraId: string;
  label: string;
  path: string;
  namespace?: string;
  trackNames?: OpenArmHfLiveRealSenseTrackNames;
  pose: OpenArmHfLiveCameraPose;
};
export const OPENARM_HF_LIVE_REALSENSE_SOURCES: readonly OpenArmHfLiveRealSenseSource[] =
  [
    {
      id: OPENARM_HF_LIVE_SOURCE_ID,
      cameraId: OPENARM_HF_LIVE_CAMERA_ID,
      label: OPENARM_HF_LIVE_CAMERA_LABEL,
      path: OPENARM_HF_LIVE_BAGUETTE_REALSENSE_PATH,
      pose: OPENARM_HF_LIVE_REAL_SENSE_POSE,
    },
  ];
export const OPENARM_HF_LIVE_CAN_TRACK_NAME = "can";
export const OPENARM_HF_LIVE_CAN_STATE_PATH_SUFFIX = "/state";
export const OPENARM_HF_LIVE_CAN_COMMAND_PATH_SEGMENT =
  OPENARM_HF_LIVE_BROWSER_SECURITY_PARAMS.canCommandPathSegment;
export const OPENARM_HF_LIVE_PATH_SEPARATOR =
  OPENARM_HF_LIVE_BROWSER_SECURITY_PARAMS.pathSeparator;
export const OPENARM_HF_LIVE_CAN_FRAME_BYTES = 72;
export const OPENARM_HF_LIVE_CAN_EXTENDED_ID_FLAG = 2_147_483_648;
export const OPENARM_HF_LIVE_CAN_EXTENDED_ID_MASK = 536_870_911;
export const OPENARM_HF_LIVE_CAN_STANDARD_ID_MASK = 2_047;
export const OPENARM_HF_LIVE_CAN_DATA_LENGTH_OFFSET = 4;
export const OPENARM_HF_LIVE_CAN_PAYLOAD_OFFSET = 8;
export const OPENARM_HF_LIVE_CAN_MAX_PAYLOAD_BYTES = 64;
export const OPENARM_HF_LIVE_CAN_JOINT_ID_NIBBLE_MASK = 0x0F;
export const OPENARM_HF_LIVE_CAN_FIRST_JOINT_ID_NIBBLE = 1;
export const OPENARM_HF_LIVE_CAN_LAST_JOINT_ID_NIBBLE = 8;
export const OPENARM_HF_LIVE_CAN_MOTOR_PACKET_BYTES = 8;
export const OPENARM_HF_LIVE_CAN_POSITION_LIMIT_RAD = 12.5;
export const OPENARM_HF_LIVE_CAN_VELOCITY_LIMIT_RAD_PER_SEC = 45;
export const OPENARM_HF_LIVE_CAN_TORQUE_LIMIT_NM = 18;
export const OPENARM_HF_LIVE_CAN_UINT16_MAX = 65_535;
export const OPENARM_HF_LIVE_CAN_UINT12_MAX = 4_095;
export const OPENARM_HF_LIVE_CAN_BYTE_SHIFT = 8;
export const OPENARM_HF_LIVE_CAN_NIBBLE_SHIFT = 4;
export const OPENARM_HF_LIVE_CAN_LOW_NIBBLE_MASK = 0x0F;
export const OPENARM_HF_LIVE_CAN_JOINT_SUFFIXES = [
  "joint1",
  "joint2",
  "joint3",
  "joint4",
  "joint5",
  "joint6",
  "joint7",
  "finger_joint1",
] as const;
export type OpenArmHfLiveCanSource = {
  id: string;
  label: string;
  path: string;
  jointPrefix: string;
};
export const OPENARM_HF_LIVE_CAN_SOURCES: readonly OpenArmHfLiveCanSource[] =
  [];
export const OPENARM_HF_LIVE_POINT_COMPONENTS = 3;
export const OPENARM_HF_LIVE_COLOR_MAX = 255;
export const OPENARM_HF_LIVE_RGBA_COMPONENTS = 4;
export const OPENARM_HF_LIVE_RED_CHANNEL_OFFSET = 0;
export const OPENARM_HF_LIVE_GREEN_CHANNEL_OFFSET = 1;
export const OPENARM_HF_LIVE_BLUE_CHANNEL_OFFSET = 2;
export const OPENARM_HF_LIVE_TIMESTAMP_PREFIX_BYTES = 8;
export const OPENARM_HF_LIVE_BOX_HEADER_BYTES = 8;
export const OPENARM_HF_LIVE_BOX_TYPE_OFFSET = 4;
export const OPENARM_HF_LIVE_BOX_MIN_SIZE = 8;
export const OPENARM_HF_LIVE_CODEC_SCAN_TRAILING_BYTES = 11;
export const OPENARM_HF_LIVE_AV1C_PAYLOAD_OFFSET = 8;
export const OPENARM_HF_LIVE_AVC_CODEC_BYTES = 3;
export const OPENARM_HF_LIVE_AV1_PROFILE_SHIFT = 5;
export const OPENARM_HF_LIVE_AV1_PROFILE_MASK = 7;
export const OPENARM_HF_LIVE_AV1_LEVEL_MASK = 31;
export const OPENARM_HF_LIVE_AV1_TIER_SHIFT = 7;
export const OPENARM_HF_LIVE_AV1_HIGH_BIT_DEPTH_SHIFT = 6;
export const OPENARM_HF_LIVE_AV1_TWELVE_BIT_SHIFT = 5;
export const OPENARM_HF_LIVE_AV1_TEN_BIT = 10;
export const OPENARM_HF_LIVE_AV1_TWELVE_BIT = 12;
export const OPENARM_HF_LIVE_AV1_EIGHT_BIT = 8;
export const OPENARM_HF_LIVE_FIRST_MEDIA_BOX_SCAN_START = 0;
export const OPENARM_HF_LIVE_AV1_TEMPORAL_DELIMITER_OBU_TYPE = 2;
export const OPENARM_HF_LIVE_AV1_SEQUENCE_HEADER_MIN_OBU_TYPE = 3;
export const OPENARM_HF_LIVE_AV1_SEQUENCE_HEADER_MAX_OBU_TYPE = 6;
export const OPENARM_HF_LIVE_AV1_OBU_TYPE_SHIFT = 3;
export const OPENARM_HF_LIVE_AV1_OBU_TYPE_MASK = 15;
export const OPENARM_HF_LIVE_AV1_OBU_EXTENSION_FLAG_SHIFT = 2;
export const OPENARM_HF_LIVE_AV1_OBU_HAS_SIZE_FIELD_SHIFT = 1;
export const OPENARM_HF_LIVE_AV1_OBU_SIZE_CHUNK_BITS = 7;
export const OPENARM_HF_LIVE_AV1_OBU_SIZE_CONTINUATION_MASK = 128;
export const OPENARM_HF_LIVE_AV1_OBU_SIZE_VALUE_MASK = 127;
export const OPENARM_HF_LIVE_AV1_MAX_LEB128_BYTES = 8;
export const OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_RGBA_COMPONENTS = 4;
export const OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_GREEN_CHANNEL_OFFSET = 1;
export const OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_8BIT_BT709_DIVISOR = 1.164;
export const OPENARM_HF_LIVE_DEPTH_VIDEO_FRAME_8BIT_BT709_OFFSET = 16;
export const OPENARM_HF_LIVE_CANVAS_CONTEXT_OPTIONS = {
  alpha: false,
  willReadFrequently: true,
} as const;
export const OPENARM_HF_LIVE_STATUS_IDLE = "OpenArm live observe is idle.";
export const OPENARM_HF_LIVE_STATUS_CONNECTING =
  "Connecting OpenArm live observe...";
export const OPENARM_HF_LIVE_STATUS_CONNECTED =
  OPENARM_HF_LIVE_BROWSER_SECURITY_PARAMS.statusConnected;
export const OPENARM_HF_LIVE_STATUS_WAITING_FOR_VIDEO =
  OPENARM_HF_LIVE_BROWSER_SECURITY_PARAMS.statusWaitingForVideo;
export const OPENARM_HF_LIVE_STATUS_PRIVATE_PROXY_REQUIRED =
  OPENARM_HF_LIVE_BROWSER_SECURITY_PARAMS.statusPrivateProxyRequired;

export const normalizeOpenArmHfLiveObservePath = (path: string): string => {
  const normalized = path.trim().replace(/\/+$/g, "");
  const pathSegments = normalized
    .split(OPENARM_HF_LIVE_PATH_SEPARATOR)
    .filter(Boolean);
  if (pathSegments.includes(OPENARM_HF_LIVE_CAN_COMMAND_PATH_SEGMENT)) {
    throw new Error("OpenArm live observe cannot connect to command paths.");
  }
  if (normalized.endsWith(OPENARM_HF_LIVE_CAN_STATE_PATH_SUFFIX)) {
    return normalized.slice(0, -OPENARM_HF_LIVE_CAN_STATE_PATH_SUFFIX.length);
  }
  return normalized;
};
