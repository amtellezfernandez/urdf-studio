export type ViewerRuntime = "studio3D" | "rosViz";
export type RosVizRuntimeDecisionReason =
  | "enabled"
  | "prefer_studio_runtime"
  | "thumbnail_mode"
  | "flag_disabled"
  | "backend_unavailable"
  | "webgpu_unavailable";

export type RosVizRuntimeDecisionInput = {
  thumbnailMode?: boolean;
  preferStudioRuntime?: boolean;
  rosVizFlagEnabled: boolean;
  rosVizGateEnabled: boolean;
  rosVizGateReason?: string;
  webGpuSupported?: boolean;
};

export type RosVizRuntimeDecision = {
  runtime: ViewerRuntime;
  reason: RosVizRuntimeDecisionReason;
  message: string;
};

export const canUseWebGpu = (): boolean =>
  typeof navigator !== "undefined" && "gpu" in navigator;

export const getRosVizRuntimeDecision = (
  input: RosVizRuntimeDecisionInput
): RosVizRuntimeDecision => {
  if (input.preferStudioRuntime) {
    return {
      runtime: "studio3D",
      reason: "prefer_studio_runtime",
      message: "Studio 3D renderer was explicitly requested.",
    };
  }
  if (input.thumbnailMode) {
    return {
      runtime: "studio3D",
      reason: "thumbnail_mode",
      message: "ROS Viz is disabled in thumbnail mode. Studio 3D renderer is active.",
    };
  }
  if (!input.rosVizGateEnabled) {
    return {
      runtime: "studio3D",
      reason: "backend_unavailable",
      message: input.rosVizGateReason || "ROS Viz backend is unavailable.",
    };
  }
  if (input.webGpuSupported === false) {
    return {
      runtime: "studio3D",
      reason: "webgpu_unavailable",
      message: "WebGPU is unavailable in this browser/device. Studio 3D renderer is active.",
    };
  }
  if (!input.rosVizFlagEnabled) {
    return {
      runtime: "studio3D",
      reason: "flag_disabled",
      message: "ROS Viz is disabled. Studio 3D renderer is active.",
    };
  }
  return {
    runtime: "rosViz",
    reason: "enabled",
    message: "ROS Viz renderer is enabled.",
  };
};
