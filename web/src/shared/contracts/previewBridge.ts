const APPLY_WORLD_LAYOUT_MESSAGE_TYPE = "urdf-star:apply-world-layout-url";
export const APPLY_WORLD_LAYOUT_RESULT_MESSAGE_TYPE = "urdf-star:world-layout-apply-result";
export const RUN_RUNTIME_DEMO_SCAN_MESSAGE_TYPE = "urdf-star:runtime-demo-scan";
export const SET_RUNTIME_DEMO_TRAJECTORY_MESSAGE_TYPE = "urdf-star:runtime-demo-trajectory";
export const SET_RUNTIME_DEMO_RESTRICTED_AREA_MESSAGE_TYPE =
  "urdf-star:runtime-demo-restricted-area";
export const SET_RUNTIME_DEMO_SPEED_MESSAGE_TYPE = "urdf-star:runtime-demo-speed";
export const DIRECT_RUNTIME_DEMO_COMMAND_MESSAGE_TYPE = "urdf-star:runtime-demo-direct-command";
export const SELECT_RUNTIME_OBJECT_MESSAGE_TYPE = "urdf-star:runtime-object-selected";
export const RUNTIME_POSE_SAMPLE_MESSAGE_TYPE = "urdf-star:runtime-pose-sample";
export const RESET_RUNTIME_TRACE_MESSAGE_TYPE = "urdf-star:runtime-trace-reset";

export type ApplyWorldLayoutMessage = {
  type: typeof APPLY_WORLD_LAYOUT_MESSAGE_TYPE;
  requestId?: string;
  worldLayoutUrl?: string;
};

export type ApplyWorldLayoutResultMessage = {
  type: typeof APPLY_WORLD_LAYOUT_RESULT_MESSAGE_TYPE;
  requestId?: string;
  ok: boolean;
  message?: string;
};

export type RunRuntimeDemoScanMessage = {
  type: typeof RUN_RUNTIME_DEMO_SCAN_MESSAGE_TYPE;
  requestId?: string;
};

export type SetRuntimeDemoTrajectoryMessage = {
  type: typeof SET_RUNTIME_DEMO_TRAJECTORY_MESSAGE_TYPE;
  requestId?: string;
  fromLabel?: string | null;
  toLabel?: string | null;
};

export type SetRuntimeDemoRestrictedAreaMessage = {
  type: typeof SET_RUNTIME_DEMO_RESTRICTED_AREA_MESSAGE_TYPE;
  requestId?: string;
  areaIds?: string[];
};

export type SetRuntimeDemoSpeedMessage = {
  type: typeof SET_RUNTIME_DEMO_SPEED_MESSAGE_TYPE;
  requestId?: string;
  speedMode?: "slow" | "normal" | "fast";
};

export type DirectRuntimeDemoCommandMessage = {
  type: typeof DIRECT_RUNTIME_DEMO_COMMAND_MESSAGE_TYPE;
  requestId?: string;
  command?: "move" | "rotate" | "stop" | "status";
  xVel?: number;
  yVel?: number;
  durationS?: number;
  degrees?: number;
  thetaVel?: number;
};

export type SelectRuntimeObjectMessage = {
  type: typeof SELECT_RUNTIME_OBJECT_MESSAGE_TYPE;
  requestId?: string;
  label?: string | null;
};

export type RuntimePoseSampleMessage = {
  type: typeof RUNTIME_POSE_SAMPLE_MESSAGE_TYPE;
  requestId?: string;
  x?: number;
  y?: number;
  yawDeg?: number;
  tMs?: number;
};

export type ResetRuntimeTraceMessage = {
  type: typeof RESET_RUNTIME_TRACE_MESSAGE_TYPE;
  requestId?: string;
  reason?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isApplyWorldLayoutMessage = (value: unknown): value is ApplyWorldLayoutMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== APPLY_WORLD_LAYOUT_MESSAGE_TYPE) return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  if (value.worldLayoutUrl != null && typeof value.worldLayoutUrl !== "string") return false;
  return true;
};

export const isApplyWorldLayoutResultMessage = (
  value: unknown
): value is ApplyWorldLayoutResultMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== APPLY_WORLD_LAYOUT_RESULT_MESSAGE_TYPE) return false;
  if (typeof value.ok !== "boolean") return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  if (value.message != null && typeof value.message !== "string") return false;
  return true;
};

export const isRunRuntimeDemoScanMessage = (
  value: unknown
): value is RunRuntimeDemoScanMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== RUN_RUNTIME_DEMO_SCAN_MESSAGE_TYPE) return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  return true;
};

export const isSetRuntimeDemoTrajectoryMessage = (
  value: unknown
): value is SetRuntimeDemoTrajectoryMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== SET_RUNTIME_DEMO_TRAJECTORY_MESSAGE_TYPE) return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  if (value.fromLabel != null && typeof value.fromLabel !== "string") return false;
  if (value.toLabel != null && typeof value.toLabel !== "string") return false;
  return true;
};

export const isSetRuntimeDemoRestrictedAreaMessage = (
  value: unknown
): value is SetRuntimeDemoRestrictedAreaMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== SET_RUNTIME_DEMO_RESTRICTED_AREA_MESSAGE_TYPE) return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  if (
    value.areaIds != null &&
    (!Array.isArray(value.areaIds) || value.areaIds.some((item) => typeof item !== "string"))
  ) {
    return false;
  }
  return true;
};

export const isSetRuntimeDemoSpeedMessage = (
  value: unknown
): value is SetRuntimeDemoSpeedMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== SET_RUNTIME_DEMO_SPEED_MESSAGE_TYPE) return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  if (
    value.speedMode != null &&
    value.speedMode !== "slow" &&
    value.speedMode !== "normal" &&
    value.speedMode !== "fast"
  ) {
    return false;
  }
  return true;
};

export const isDirectRuntimeDemoCommandMessage = (
  value: unknown
): value is DirectRuntimeDemoCommandMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== DIRECT_RUNTIME_DEMO_COMMAND_MESSAGE_TYPE) return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  if (
    value.command != null &&
    value.command !== "move" &&
    value.command !== "rotate" &&
    value.command !== "stop" &&
    value.command !== "status"
  ) {
    return false;
  }
  if (value.xVel != null && typeof value.xVel !== "number") return false;
  if (value.yVel != null && typeof value.yVel !== "number") return false;
  if (value.durationS != null && typeof value.durationS !== "number") return false;
  if (value.degrees != null && typeof value.degrees !== "number") return false;
  if (value.thetaVel != null && typeof value.thetaVel !== "number") return false;
  return true;
};

export const isSelectRuntimeObjectMessage = (
  value: unknown
): value is SelectRuntimeObjectMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== SELECT_RUNTIME_OBJECT_MESSAGE_TYPE) return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  if (value.label != null && typeof value.label !== "string") return false;
  return true;
};

export const isRuntimePoseSampleMessage = (
  value: unknown
): value is RuntimePoseSampleMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== RUNTIME_POSE_SAMPLE_MESSAGE_TYPE) return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  if (value.x != null && typeof value.x !== "number") return false;
  if (value.y != null && typeof value.y !== "number") return false;
  if (value.yawDeg != null && typeof value.yawDeg !== "number") return false;
  if (value.tMs != null && typeof value.tMs !== "number") return false;
  return true;
};

export const isResetRuntimeTraceMessage = (
  value: unknown
): value is ResetRuntimeTraceMessage => {
  if (!isRecord(value)) return false;
  if (value.type !== RESET_RUNTIME_TRACE_MESSAGE_TYPE) return false;
  if (value.requestId != null && typeof value.requestId !== "string") return false;
  if (value.reason != null && typeof value.reason !== "string") return false;
  return true;
};
