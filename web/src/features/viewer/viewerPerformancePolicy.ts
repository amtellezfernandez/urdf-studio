import type { WorkspaceMode } from "@/features/workspace/types";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";

export type ViewerRenderPerformancePolicy = {
  effectiveGpuMode: GPUMode;
  canvasDpr: [number, number];
  enableCanvasAntialias: boolean;
  canvasPowerPreference: WebGLPowerPreference;
  enableShadows: boolean;
  canPublishLiveRobotBasePose: boolean;
  canRunStudioWheelDrive: boolean;
};

type ViewerRenderPerformancePolicyInput = {
  requestedGpuMode: GPUMode;
  workspaceMode: WorkspaceMode;
  thumbnailMode: boolean;
  readOnlyMode: boolean;
  showStudioSceneChrome: boolean;
};

export const resolveEffectiveViewerGpuMode = ({
  requestedGpuMode,
  workspaceMode,
  thumbnailMode,
  readOnlyMode,
}: Pick<
  ViewerRenderPerformancePolicyInput,
  "requestedGpuMode" | "workspaceMode" | "thumbnailMode" | "readOnlyMode"
>): GPUMode => {
  if (thumbnailMode || readOnlyMode || workspaceMode !== "studio") {
    return "low";
  }
  return requestedGpuMode;
};

export const buildViewerRenderPerformancePolicy = ({
  requestedGpuMode,
  workspaceMode,
  thumbnailMode,
  readOnlyMode,
  showStudioSceneChrome,
}: ViewerRenderPerformancePolicyInput): ViewerRenderPerformancePolicy => {
  const effectiveGpuMode = resolveEffectiveViewerGpuMode({
    requestedGpuMode,
    workspaceMode,
    thumbnailMode,
    readOnlyMode,
  });
  const isActiveStudioEditMode =
    workspaceMode === "studio" && !thumbnailMode && !readOnlyMode;
  const highPowerStudio = isActiveStudioEditMode && effectiveGpuMode === "high";

  return {
    effectiveGpuMode,
    canvasDpr: highPowerStudio ? [1, 1.5] : [0.75, 1],
    enableCanvasAntialias: highPowerStudio,
    canvasPowerPreference: highPowerStudio ? "high-performance" : "low-power",
    enableShadows: showStudioSceneChrome && highPowerStudio,
    canPublishLiveRobotBasePose: isActiveStudioEditMode,
    canRunStudioWheelDrive: isActiveStudioEditMode,
  };
};
