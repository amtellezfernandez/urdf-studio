import type { RobotBasePose } from "@/shared/types/feature";

export type KinematicFingerprintVersion = "v1";
export type NamingStatus = "named" | "unnamed";

export interface EmbodimentRef {
  embodiment_id: string;
  kinematic_fingerprint?: string;
  kinematic_fingerprint_version?: KinematicFingerprintVersion;
  robot_type?: string;
  urdf_sha256?: string;
  srdf_sha256?: string;
  base_frame?: string;
  ee_frame?: string;
}

export interface EpisodeFrame {
  timestamp: number;
  joints: Record<string, number>;
  base_pose?: RobotBasePose;
}

export interface EpisodeMetadata extends Record<string, unknown> {
  episodeNumber?: number;
  episode_index?: number;
  task_index?: number;
  tasks?: string[];
  robot_type?: string;
  embodiment_ref?: EmbodimentRef;
  representation_id?: string;
  naming_status?: NamingStatus;
  mapping_ids?: string[];
  fps?: number;
  joint_names?: string[];
  videos?: Record<string, unknown>;
  episode_length_sec?: number;
  recorded_at?: string;
  codebase_version?: string;
  num_frames?: number;
  total_frames?: number;
  total_episodes?: number;
  data_path?: string;
  video_path?: string;
  stats?: Record<string, unknown>;
  label?: string;
  createdAt?: number;
  generatedAt?: string;
  episode_id?: string;
  signal_profile_id?: string;
  signal_profile_version?: string;
  signal_base_mode?: "none" | "twist" | "pose";
  signal_mapping_report?: {
    mappedChannels?: number;
    unmappedChannels?: number;
    unmappedNames?: string[];
    confidence?: "high" | "medium" | "low";
  };
  world_snapshot_ref?: {
    package_id: string;
    version: string;
    digest_sha256?: string;
  };
  additional?: Record<string, unknown>;
  base_poses?: Array<RobotBasePose | null>;
}
