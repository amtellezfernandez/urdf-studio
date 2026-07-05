import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  syncSimulationPrepInertiaVisualizationScope,
  type SimulationPrepVisualizationPreview,
  withSimulationPrepInertiaVisualization,
} from "@/features/layout/page/simulationPrepViewerState";
import type { InertialVisualizationSettings } from "@/shared/types/feature";

export const cloneInertialVisualizationSettings = (
  settings: InertialVisualizationSettings
): InertialVisualizationSettings => ({
  ...settings,
  scopedLinkNames: settings.scopedLinkNames ? [...settings.scopedLinkNames] : null,
});

const captureInertialVisualizationSnapshot = (
  snapshotRef: MutableRefObject<InertialVisualizationSettings | null>,
  settings: InertialVisualizationSettings
) => {
  if (!snapshotRef.current) {
    snapshotRef.current = cloneInertialVisualizationSettings(settings);
  }
};

const restoreInertialVisualizationSnapshot = (
  current: InertialVisualizationSettings,
  snapshot: InertialVisualizationSettings | null
): InertialVisualizationSettings => {
  if (snapshot) {
    return cloneInertialVisualizationSettings(snapshot);
  }
  return current.scopedLinkNames === null
    ? current
    : syncSimulationPrepInertiaVisualizationScope(current);
};

export const useSimulationPrepViewerHighlights = ({
  panelOpen,
  setActiveInertiaVisualizationScopeKey,
  setHoveredInertiaVisualizationPreview,
  setInertialVisualization,
  setShowHealthActionPanel,
  setShowLoadIssues,
  setSimulationPrepResetPoseRequestKey,
}: {
  panelOpen: boolean;
  setActiveInertiaVisualizationScopeKey: Dispatch<SetStateAction<string | null>>;
  setHoveredInertiaVisualizationPreview: Dispatch<
    SetStateAction<SimulationPrepVisualizationPreview | null>
  >;
  setInertialVisualization: Dispatch<SetStateAction<InertialVisualizationSettings>>;
  setShowHealthActionPanel: Dispatch<SetStateAction<boolean>>;
  setShowLoadIssues: Dispatch<SetStateAction<boolean>>;
  setSimulationPrepResetPoseRequestKey: Dispatch<SetStateAction<string>>;
}) => {
  const inertialVisualizationBeforeOpenRef =
    useRef<InertialVisualizationSettings | null>(null);

  const discardSimulationPrepViewerHighlightSnapshot = useCallback(() => {
    inertialVisualizationBeforeOpenRef.current = null;
  }, []);

  const resetSimulationPrepTransientPreviewState = useCallback(() => {
    setHoveredInertiaVisualizationPreview(null);
    setActiveInertiaVisualizationScopeKey(null);
  }, [setActiveInertiaVisualizationScopeKey, setHoveredInertiaVisualizationPreview]);

  const enableSimulationPrepViewerHighlights = useCallback(
    (scopedLinkNames?: readonly string[] | null) => {
      setInertialVisualization((current) => {
        captureInertialVisualizationSnapshot(inertialVisualizationBeforeOpenRef, current);
        return withSimulationPrepInertiaVisualization(current, scopedLinkNames);
      });
    },
    [setInertialVisualization]
  );

  const restoreSimulationPrepViewerHighlights = useCallback(() => {
    setInertialVisualization((current) => {
      const previous = inertialVisualizationBeforeOpenRef.current;
      inertialVisualizationBeforeOpenRef.current = null;
      return restoreInertialVisualizationSnapshot(current, previous);
    });
  }, [setInertialVisualization]);

  const clearSimulationPrepViewerHighlights = useCallback(() => {
    resetSimulationPrepTransientPreviewState();
    restoreSimulationPrepViewerHighlights();
  }, [resetSimulationPrepTransientPreviewState, restoreSimulationPrepViewerHighlights]);

  const closeSimulationPrepPanel = useCallback(() => {
    setShowHealthActionPanel(false);
    clearSimulationPrepViewerHighlights();
  }, [clearSimulationPrepViewerHighlights, setShowHealthActionPanel]);

  const openSimulationPrepPanel = useCallback(() => {
    setShowLoadIssues(false);
    enableSimulationPrepViewerHighlights();
    resetSimulationPrepTransientPreviewState();
    setSimulationPrepResetPoseRequestKey(String(Date.now()));
    setShowHealthActionPanel(true);
  }, [
    enableSimulationPrepViewerHighlights,
    resetSimulationPrepTransientPreviewState,
    setShowHealthActionPanel,
    setShowLoadIssues,
    setSimulationPrepResetPoseRequestKey,
  ]);

  useEffect(() => {
    if (panelOpen) {
      return;
    }
    clearSimulationPrepViewerHighlights();
  }, [clearSimulationPrepViewerHighlights, panelOpen]);

  return {
    clearSimulationPrepViewerHighlights,
    closeSimulationPrepPanel,
    discardSimulationPrepViewerHighlightSnapshot,
    enableSimulationPrepViewerHighlights,
    openSimulationPrepPanel,
    restoreSimulationPrepViewerHighlights,
  };
};
