import { isFeatureFlagEnabled } from "@/shared/config/featureFlags";

export type ViewerRuntime = "studio3D" | "rosVizV2";
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
      message: "ROS viz v2 is disabled in thumbnail mode. Studio 3D renderer is active.",
    };
  }
  if (!input.rosVizGateEnabled) {
    return {
      runtime: "studio3D",
      reason: "backend_unavailable",
      message: input.rosVizGateReason || "ROS viz backend is unavailable.",
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
      message: "ROS viz v2 is disabled. Studio 3D renderer is active.",
    };
  }
  return {
    runtime: "rosVizV2",
    reason: "enabled",
    message: "ROS viz v2 renderer is enabled.",
  };
};

export const shouldUseRosVizV2Runtime = (): boolean =>
  getRosVizRuntimeDecision({
    rosVizFlagEnabled: isFeatureFlagEnabled("rosVizV2"),
    rosVizGateEnabled: true,
    webGpuSupported: canUseWebGpu(),
  }).runtime === "rosVizV2";
