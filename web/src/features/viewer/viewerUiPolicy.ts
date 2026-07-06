import type { WorkspaceMode } from "@/features/workspace/types";
import type { GPUMode } from "@/shared/hooks/use-gpu-mode";
import {
  buildViewerRenderPerformancePolicy,
  type ViewerRenderPerformancePolicy,
} from "@/features/viewer/viewerPerformancePolicy";

export type ViewerChromePolicy = ViewerRenderPerformancePolicy & {
  hasStudioRobot: boolean;
  canUseReadOnlyRoverGuide: boolean;
  showSceneChrome: boolean;
  showEditableChrome: boolean;
  showStudioSceneChrome: boolean;
  showStudioEditableSceneChrome: boolean;
  showTopRightTools: boolean;
  showHeader: boolean;
};

export type ViewerUiPolicy = {
  showHeader: boolean;
  showJointTypesPanel: boolean;
  showEndEffectorSummary: boolean;
  showSceneChrome: boolean;
  showStudioSceneChrome: boolean;
  showStudioEditableSceneChrome: boolean;
  showIkHandles: boolean;
  showWheelRoleMarkers: boolean;
  showCreatedObjects: boolean;
  showIkDialog: boolean;
  showTopRightTools: boolean;
  canvasDpr: [number, number];
  enableCanvasAntialias: boolean;
  canvasPowerPreference: WebGLPowerPreference;
  enableShadows: boolean;
  canPublishLiveRobotBasePose: boolean;
  canRunStudioWheelDrive: boolean;
};

export const buildViewerChromePolicy = ({
  requestedGpuMode,
  workspaceMode,
  thumbnailMode,
  readOnlyMode,
  showStudioChrome,
  hasStudioRobot,
  hasUrdfFile,
}: {
  requestedGpuMode: GPUMode;
  workspaceMode: WorkspaceMode;
  thumbnailMode: boolean;
  readOnlyMode: boolean;
  showStudioChrome: boolean;
  hasStudioRobot: boolean;
  hasUrdfFile: boolean;
}): ViewerChromePolicy => {
  const showSceneChrome = !thumbnailMode;
  const showEditableChrome = showSceneChrome && !readOnlyMode;
  const showStudioSceneChrome = showSceneChrome && showStudioChrome;
  const showStudioEditableSceneChrome = showStudioSceneChrome && !readOnlyMode;
  const renderPerformancePolicy = buildViewerRenderPerformancePolicy({
    requestedGpuMode,
    workspaceMode,
    thumbnailMode,
    readOnlyMode,
    showStudioSceneChrome,
  });

  return {
    hasStudioRobot,
    canUseReadOnlyRoverGuide: readOnlyMode && hasStudioRobot,
    showSceneChrome,
    showEditableChrome,
    showStudioSceneChrome,
    showStudioEditableSceneChrome,
    showTopRightTools: showStudioSceneChrome && hasUrdfFile,
    showHeader: showEditableChrome,
    ...renderPerformancePolicy,
  };
};

export const buildViewerUiPolicy = ({
  viewerPolicy,
  showIkPanel,
  hasJointLimits,
  isWheelRolesOpen,
  ikHandlesReady,
  ikEndEffectorLinkCount,
  ikDragEnabled,
  ikDragSuppressed,
  simulationPrepPanelOpen,
  hasUrdfContent,
  showWorldLayoutOverlays,
}: {
  viewerPolicy: ViewerChromePolicy;
  showIkPanel: boolean;
  hasJointLimits: boolean;
  isWheelRolesOpen: boolean;
  ikHandlesReady: boolean;
  ikEndEffectorLinkCount: number;
  ikDragEnabled: boolean;
  ikDragSuppressed: boolean;
  simulationPrepPanelOpen: boolean;
  hasUrdfContent: boolean;
  showWorldLayoutOverlays: boolean;
}): ViewerUiPolicy => ({
  showHeader: viewerPolicy.showHeader,
  showJointTypesPanel: viewerPolicy.showEditableChrome && hasJointLimits,
  showEndEffectorSummary:
    viewerPolicy.showStudioEditableSceneChrome &&
    !isWheelRolesOpen &&
    ikHandlesReady &&
    ikEndEffectorLinkCount > 0,
  showSceneChrome: viewerPolicy.showSceneChrome,
  showStudioSceneChrome: viewerPolicy.showStudioSceneChrome,
  showStudioEditableSceneChrome: viewerPolicy.showStudioEditableSceneChrome,
  showIkHandles:
    viewerPolicy.showStudioEditableSceneChrome &&
    showIkPanel &&
    !simulationPrepPanelOpen &&
    !ikDragSuppressed &&
    ikHandlesReady &&
    ikDragEnabled &&
    hasUrdfContent &&
    ikEndEffectorLinkCount > 0,
  showWheelRoleMarkers:
    viewerPolicy.showStudioEditableSceneChrome && isWheelRolesOpen,
  showCreatedObjects:
    viewerPolicy.showStudioSceneChrome && showWorldLayoutOverlays,
  showIkDialog: showIkPanel,
  showTopRightTools: viewerPolicy.showTopRightTools,
  canvasDpr: viewerPolicy.canvasDpr,
  enableCanvasAntialias: viewerPolicy.enableCanvasAntialias,
  canvasPowerPreference: viewerPolicy.canvasPowerPreference,
  enableShadows: viewerPolicy.enableShadows,
  canPublishLiveRobotBasePose: viewerPolicy.canPublishLiveRobotBasePose,
  canRunStudioWheelDrive: viewerPolicy.canRunStudioWheelDrive,
});
