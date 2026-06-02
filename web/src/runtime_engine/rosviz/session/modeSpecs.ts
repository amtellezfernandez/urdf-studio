import type {
  RosVizDataSource,
  RosVizSessionMode,
  RosVizSessionState,
} from "@/runtime_engine/rosviz/types";

export type RosVizSessionModeOption = {
  mode: RosVizSessionMode;
  label: string;
  description: string;
};

export const ROSVIZ_SESSION_MODE_OPTIONS: RosVizSessionModeOption[] = [
  {
    mode: "live_debug",
    label: "Live Debug",
    description: "Live ROS stream inspection and diagnostics.",
  },
  {
    mode: "live_record",
    label: "Live Record",
    description: "Live ROS stream plus recording controls.",
  },
  {
    mode: "replay_rosbag",
    label: "Replay Rosbag",
    description: "Deterministic timeline over rosbag data.",
  },
  {
    mode: "replay_episode",
    label: "Replay Episode",
    description: "Episode dataset replay with timeline controls.",
  },
  {
    mode: "replay_motion_only",
    label: "Motion Only",
    description: "Trajectory/motion replay without external sensors.",
  },
  {
    mode: "hybrid_compare",
    label: "Hybrid Compare",
    description: "Compare live and replay sources in one session.",
  },
];

export const resolveDefaultSessionMode = (
  dataSource: RosVizDataSource
): RosVizSessionMode => {
  if (dataSource === "replay") {
    return "replay_rosbag";
  }
  if (dataSource === "episode") {
    return "replay_episode";
  }
  return "live_debug";
};

export const canChangePlaybackState = (state: RosVizSessionState | null): boolean => {
  if (!state) return false;
  return state.capabilities.can_toggle_play;
};
