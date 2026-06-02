import { isFeatureFlagEnabled } from "@/shared/config/featureFlags";

export type ViewerRuntime = "legacy" | "rosVizV2";
export type RosVizRuntimeDecisionReason =
  | "enabled"
  | "prefer_legacy_runtime"
  | "thumbnail_mode"
  | "flag_disabled"
  | "backend_unavailable"
  | "webgpu_unavailable";

export type RosVizRuntimeDecisionInput = {
  thumbnailMode?: boolean;
  preferLegacyRuntime?: boolean;
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
  if (input.preferLegacyRuntime) {
    return {
      runtime: "legacy",
      reason: "prefer_legacy_runtime",
      message: "Legacy Studio 3D renderer was explicitly requested.",
    };
  }
  if (input.thumbnailMode) {
    return {
      runtime: "legacy",
      reason: "thumbnail_mode",
      message: "ROS viz v2 is disabled in thumbnail mode. Studio 3D renderer is active.",
    };
  }
  if (!input.rosVizGateEnabled) {
    return {
      runtime: "legacy",
      reason: "backend_unavailable",
      message: input.rosVizGateReason || "ROS viz backend is unavailable.",
    };
  }
  if (input.webGpuSupported === false) {
    return {
      runtime: "legacy",
      reason: "webgpu_unavailable",
      message: "WebGPU is unavailable in this browser/device. Studio 3D renderer is active.",
    };
  }
  if (!input.rosVizFlagEnabled) {
    return {
      runtime: "legacy",
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
