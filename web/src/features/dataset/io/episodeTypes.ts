export interface EpisodeFrame {
  timestamp: number;
  joints: Record<string, number>;
}

export interface EpisodeMetadata extends Record<string, unknown> {
  episodeNumber?: number;
  episode_index?: number;
  task_index?: number;
  tasks?: string[];
  robot_type?: string;
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
  additional?: Record<string, unknown>;
}
