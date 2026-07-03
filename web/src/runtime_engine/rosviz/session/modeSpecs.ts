import type {
  RosVizDataSource,
  RosVizSessionMode,
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
];

export const resolveDefaultSessionMode = (
  _dataSource: RosVizDataSource
): RosVizSessionMode => {
  return "live_debug";
};
