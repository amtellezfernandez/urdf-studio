export const RUNTIME_ROBOT_PREVIEW_NAME = "LeKiwi";
export const RUNTIME_ROBOT_PREVIEW_QUERY = "?runtime_preview=1&demo=1&runtime_demo=1";
export const RUNTIME_PREVIEW_BUTTERCLAW_OBJECTS_POLL_INTERVAL_MS = 1500;
export const RUNTIME_PREVIEW_BUTTERCLAW_POSE_POLL_INTERVAL_MS = 250;
export const RUNTIME_DEMO_QUERY_PARAM = "runtime_demo";
export const RUNTIME_DEMO_QUERY_VALUE = "1";
const RUNTIME_DEMO_TRAJECTORY_FROM_QUERY_PARAM = "runtime_demo_from";
const RUNTIME_DEMO_TRAJECTORY_TO_QUERY_PARAM = "runtime_demo_to";
export const RUNTIME_DEMO_OBJECT_SIZE_METERS = 0.12;
export const RUNTIME_DEMO_TRAJECTORY_POINT_SIZE_METERS = 0.018;
export const RUNTIME_DEMO_TRAJECTORY_POINT_COUNT = 6;
export const RUNTIME_DEMO_SCAN_DURATION_MS = 4800;
const RUNTIME_DEMO_SPEED_MODES = ["slow", "normal", "fast"] as const;

export type RuntimeDemoSpeedMode = (typeof RUNTIME_DEMO_SPEED_MODES)[number];

export const isRuntimeDemoEnabled = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return (
    params.get(RUNTIME_DEMO_QUERY_PARAM) === RUNTIME_DEMO_QUERY_VALUE ||
    import.meta.env.VITE_RUNTIME_DEMO === RUNTIME_DEMO_QUERY_VALUE
  );
};

export type RuntimeDemoTrajectorySelection = {
  fromLabel: string | null;
  toLabel: string | null;
};

export const readRuntimeDemoTrajectorySelection = (
  search: string
): RuntimeDemoTrajectorySelection => {
  const params = new URLSearchParams(search);
  const normalize = (value: string | null): string | null => {
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  };
  return {
    fromLabel: normalize(params.get(RUNTIME_DEMO_TRAJECTORY_FROM_QUERY_PARAM)),
    toLabel: normalize(params.get(RUNTIME_DEMO_TRAJECTORY_TO_QUERY_PARAM)),
  };
};
