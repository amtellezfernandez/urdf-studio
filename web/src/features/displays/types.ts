export type DisplayKind =
  | "robot_model"
  | "tf_frames"
  | "markers"
  | "trajectory"
  | "diagnostics_overlay";

export type DisplayStatus = "idle" | "ok" | "warning" | "error";
type DisplaySource = "runtime" | "viewer";

export type DisplayMetrics = Record<string, number>;
export type DisplayParams = Record<string, unknown>;

export type DisplayInstance = {
  kind: DisplayKind;
  label: string;
  description: string;
  enabled: boolean;
  source: DisplaySource;
  status: DisplayStatus;
  metrics: DisplayMetrics;
  params: DisplayParams;
};
