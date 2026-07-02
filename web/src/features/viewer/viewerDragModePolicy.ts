import type { DragMode } from "@/features/viewer/viewer-helpers";

type ViewerDragModePolicyParams = {
  dragMode: DragMode;
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

export const doesViewerDragModeUseIkHandles = (dragMode: DragMode): boolean =>
  dragMode === "drag-handle";

export const resolveEffectiveViewerDragMode = ({
  dragMode,
  isAssemblyWorkspace,
  simulationPrepPanelOpen = false,
}: ViewerDragModePolicyParams): DragMode => {
  return canUseViewerDragHandleMode({
    isAssemblyWorkspace,
    simulationPrepPanelOpen,
  })
    ? dragMode
    : "move-joints";
};
