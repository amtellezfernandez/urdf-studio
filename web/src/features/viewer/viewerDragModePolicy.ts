import type { DragMode } from "@/features/viewer/viewer-helpers";

type ViewerDragModePolicyParams = {
  dragMode: DragMode;
  leaderTeleopAvailable?: boolean;
  isAssemblyWorkspace: boolean;
  simulationPrepPanelOpen?: boolean;
};

type ViewerDragHandleAvailabilityParams = Pick<
  ViewerDragModePolicyParams,
  "isAssemblyWorkspace" | "simulationPrepPanelOpen"
>;

export const canUseViewerDragHandleMode = ({
  isAssemblyWorkspace,
  simulationPrepPanelOpen = false,
}: ViewerDragHandleAvailabilityParams): boolean =>
  !isAssemblyWorkspace && !simulationPrepPanelOpen;

export const canUseViewerLeaderTeleopMode = ({
  leaderTeleopAvailable = false,
  isAssemblyWorkspace,
}: Pick<
  ViewerDragModePolicyParams,
  "leaderTeleopAvailable" | "isAssemblyWorkspace"
>): boolean => leaderTeleopAvailable && !isAssemblyWorkspace;

export const doesViewerDragModeUseIkHandles = (dragMode: DragMode): boolean =>
  dragMode === "drag-handle";

export const shouldResetPoseAfterLeaderTeleopFallback = ({
  previousDragMode,
  currentDragMode,
  leaderTeleopAvailable = false,
}: {
  previousDragMode: DragMode;
  currentDragMode: DragMode;
  leaderTeleopAvailable?: boolean;
}): boolean =>
  previousDragMode === "hardware-teleop" &&
  currentDragMode === "drag-handle" &&
  !leaderTeleopAvailable;

export const resolveEffectiveViewerDragMode = ({
  dragMode,
  leaderTeleopAvailable = false,
  isAssemblyWorkspace,
  simulationPrepPanelOpen = false,
}: ViewerDragModePolicyParams): DragMode => {
  if (dragMode === "hardware-teleop") {
    return canUseViewerLeaderTeleopMode({
      leaderTeleopAvailable,
      isAssemblyWorkspace,
    })
      ? "hardware-teleop"
      : canUseViewerDragHandleMode({
          isAssemblyWorkspace,
          simulationPrepPanelOpen,
        })
        ? "drag-handle"
        : "move-joints";
  }

  return canUseViewerDragHandleMode({
    isAssemblyWorkspace,
    simulationPrepPanelOpen,
  })
    ? dragMode
    : "move-joints";
};
