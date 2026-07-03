export type RosVizQosProfile = {
  reliability: "reliable" | "best_effort";
  durability: "volatile" | "transient_local";
  history: "keep_last" | "keep_all";
  depth: number;
};

export type RosVizTopicInfo = {
  topic_id: number;
  name: string;
  schema: string;
  encoding: "json" | "flatbuffer" | "raw";
  qos: RosVizQosProfile;
};

export type RosVizDeterministicMode = "strict" | "smooth";
export type RosVizModeProfile = "studio" | "ros_debug";
export type RosVizDataSource = "live_ros";
export type RosVizClockMode = "live";
export type RosVizSessionMode = "live_debug";
export type RosVizTimeSource = "ros_clock";
export type RosVizTransportSource = "ros_topics";

export type RosVizRuntimeCapabilities = {
  can_toggle_play: boolean;
  can_step: boolean;
  can_seek: boolean;
  can_set_playback_rate: boolean;
};

export type RosVizSessionSnapshot = {
  session_id: string;
  created_at_ms: number;
  updated_at_ms: number;
  fixed_frame: string;
  ros_domain_id: number | null;
  deterministic_mode: RosVizDeterministicMode;
  mode_profile: RosVizModeProfile;
  data_source: RosVizDataSource;
  session_mode: RosVizSessionMode;
  topic_count: number;
  next_sequence: number;
  deterministic_session_hash: string;
};

export type RosVizStreamTicketResponse = {
  session_id: string;
  ticket: string;
  expires_at_ms: number;
};

export type RosVizSessionState = {
  session_id: string;
  mode: RosVizSessionMode;
  fixed_frame: string;
  deterministic_mode: RosVizDeterministicMode;
  data_source: RosVizDataSource;
  time_source: RosVizTimeSource;
  transport_source: RosVizTransportSource;
  clock_mode: RosVizClockMode;
  is_playing: boolean;
  tick_index: number;
  tick_ns: number;
  playback_rate: number;
  capabilities: RosVizRuntimeCapabilities;
  updated_at_ms: number;
};

export type RosVizModeUpdateRequest = {
  mode: RosVizSessionMode;
};

export type RosVizTopicCatalogResponse = {
  session_id: string;
  topics: RosVizTopicInfo[];
};

export type RosVizSubscriptionResponse = {
  session_id: string;
  subscribed_topic_ids: number[];
  include_clock: boolean;
};

export type RosVizClockControlRequest = {
  mode?: RosVizClockMode;
  is_playing?: boolean;
  step_ticks?: number;
  seek_tick_index?: number;
  playback_rate?: number;
};

export type RosVizClockState = {
  session_id: string;
  mode: RosVizClockMode;
  is_playing: boolean;
  tick_index: number;
  tick_ns: number;
  playback_rate: number;
  data_source: RosVizDataSource;
  session_mode: RosVizSessionMode;
  can_control: boolean;
  updated_at_ms: number;
};

export type RosVizClockTickPayload = {
  mode: RosVizClockMode;
  t_ns: number;
  tick_index: number;
};

export type RosVizResolvedFramePosePayload = {
  robot_id: string;
  frame_id: string;
  parent_frame_id: string;
  translation_xyz: [number, number, number];
  quaternion_xyzw: [number, number, number, number];
};

export type RosVizResolvedFramePoseBatchPayload = {
  fixed_frame: string;
  t_ns: number;
  pose_hash: string;
  poses: RosVizResolvedFramePosePayload[];
};

export type RosVizDiagnosticPayload = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  details?: Record<string, string>;
};

export type RosVizMarkerType = "sphere" | "cube" | "line_strip";

export type RosVizMarkerPayload = {
  namespace: string;
  marker_id: number;
  frame_id: string;
  marker_type: RosVizMarkerType;
  pose_position_xyz: [number, number, number];
  pose_quaternion_xyzw: [number, number, number, number];
  scale_xyz: [number, number, number];
  color_rgba: [number, number, number, number];
  points_xyz: [number, number, number][];
  lifetime_ms: number;
};

export type RosVizMarkerDeltaPayload = {
  action: "add_or_modify" | "delete" | "delete_all";
  namespace: string;
  marker_id: number | null;
  marker: RosVizMarkerPayload | null;
};

export type RosVizMarkerDeltaBatchPayload = {
  fixed_frame: string;
  t_ns: number;
  deltas: RosVizMarkerDeltaPayload[];
};
