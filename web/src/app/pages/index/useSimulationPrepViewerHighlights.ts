import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
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

  const enableSimulationPrepViewerHighlights = useCallback(
    (scopedLinkNames?: readonly string[] | null) => {
      setInertialVisualization((current) => {
        if (!inertialVisualizationBeforeOpenRef.current) {
          inertialVisualizationBeforeOpenRef.current =
            cloneInertialVisualizationSettings(current);
        }
        return withSimulationPrepInertiaVisualization(current, scopedLinkNames);
      });
    },
    [setInertialVisualization]
  );

  const restoreSimulationPrepViewerHighlights = useCallback(() => {
    setInertialVisualization((current) => {
      const previous = inertialVisualizationBeforeOpenRef.current;
      inertialVisualizationBeforeOpenRef.current = null;
      if (previous) {
        return cloneInertialVisualizationSettings(previous);
      }
      return current.scopedLinkNames === null
        ? current
        : syncSimulationPrepInertiaVisualizationScope(current);
    });
  }, [setInertialVisualization]);

  const clearSimulationPrepViewerHighlights = useCallback(() => {
    setHoveredInertiaVisualizationPreview(null);
    setActiveInertiaVisualizationScopeKey(null);
    restoreSimulationPrepViewerHighlights();
  }, [
    restoreSimulationPrepViewerHighlights,
    setActiveInertiaVisualizationScopeKey,
    setHoveredInertiaVisualizationPreview,
  ]);

  const closeSimulationPrepPanel = useCallback(() => {
    setShowHealthActionPanel(false);
    clearSimulationPrepViewerHighlights();
  }, [clearSimulationPrepViewerHighlights, setShowHealthActionPanel]);

  const openSimulationPrepPanel = useCallback(() => {
    setShowLoadIssues(false);
    enableSimulationPrepViewerHighlights();
    setHoveredInertiaVisualizationPreview(null);
    setActiveInertiaVisualizationScopeKey(null);
    setSimulationPrepResetPoseRequestKey(String(Date.now()));
    setShowHealthActionPanel(true);
  }, [
    enableSimulationPrepViewerHighlights,
    setActiveInertiaVisualizationScopeKey,
    setHoveredInertiaVisualizationPreview,
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
