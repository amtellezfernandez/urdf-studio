export type NativeTargetMode = "pose" | "position" | "joint";

export type NativeOrientationPolicy =
  | "required"
  | "optional"
  | "prefer"
  | "ignore"
  | "position_first";

export type NativeTargetRequest = {
  schema_version: "1";
  sequence: number;
  source_ts_ns: number;
  mode: NativeTargetMode;
  target_link: string;
  position_xyz_m: [number, number, number] | null;
  orientation_wxyz: [number, number, number, number] | null;
  joint_targets_rad: Record<string, number> | null;
  orientation_policy: NativeOrientationPolicy;
  max_linear_speed_mps: number | null;
  max_angular_speed_rps: number | null;
};

export type NativeModelLoadRequest = {
  schema_version: "1";
  urdf_xml: string;
  target_link: string;
  seed_joint_values_rad: Record<string, number> | null;
};

export type NativeModelLoadAck = {
  schema_version: "1";
  loaded: boolean;
  target_link: string;
  actuated_joint_names: string[];
  initial_ee_position_xyz_m: [number, number, number];
};

export type NativeTargetAck = {
  schema_version: "1";
  accepted: boolean;
  sequence: number;
  server_rx_ts_ns: number;
};

export type NativeTelemetryFrame = {
  schema_version: "1";
  tick_ts_ns: number;
  sequence_applied: number | null;
  q_rad: Record<string, number>;
  ee_position_xyz_m: [number, number, number];
  ee_orientation_wxyz: [number, number, number, number];
  residual_position_m: number;
  residual_orientation_rad: number;
  loop_hz: number;
  overrun: boolean;
  stale_target: boolean;
  limit_clamp_count: number;
};
