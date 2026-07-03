import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useDisplayStore } from "@/features/displays/useDisplayStore";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import {
  isFeatureFlagEnabled,
  isFeatureFlagUrlLocked,
  setFeatureFlag,
  subscribeFeatureFlags,
} from "@/shared/config/featureFlags";
import { useFeatureGateAvailability } from "@/shared/lib/featureGateUi";
import {
  canUseWebGpu,
  getRosVizRuntimeDecision,
  type ViewerRuntime,
} from "@/runtime_engine/rosviz/session/runtimeSelector";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import type { WorkspaceMode } from "@/features/workspace/types";
import {
  getViewerProfile,
  getViewerProfileSource,
  isViewerProfileUrlLocked,
  setViewerProfile,
  subscribeViewerProfile,
  type ViewerProfile,
} from "@/features/workspace/viewerProfile";

export const useWorkspaceController = () => {
  const rosVizFlagEnabled = useSyncExternalStore(
    subscribeFeatureFlags,
    () => isFeatureFlagEnabled("rosViz"),
    () => false
  );
  const rosVizFlagLocked = isFeatureFlagUrlLocked("rosViz");
  const rosVizGate = useFeatureGateAvailability(FEATURE_GATES.rosVizRuntime);
  const webGpuSupported = canUseWebGpu();

  const viewerProfile: ViewerProfile = useSyncExternalStore(
    subscribeViewerProfile,
    () => getViewerProfile(),
    () => "studio" as ViewerProfile
  );
  const viewerProfileLocked = isViewerProfileUrlLocked();
  const viewerProfileSource = getViewerProfileSource();

  const applyProfilePreset = useDisplayStore((state) => state.applyProfilePreset);

  const runtimeDecision = useMemo(
    () =>
      getRosVizRuntimeDecision({
        rosVizFlagEnabled,
        rosVizGateEnabled: rosVizGate.enabled,
        rosVizGateReason: rosVizGate.unavailableReason,
        webGpuSupported,
      }),
    [rosVizFlagEnabled, rosVizGate.enabled, rosVizGate.unavailableReason, webGpuSupported]
  );

  const handleRendererRuntimeChange = useCallback(
    (runtime: ViewerRuntime) => {
      if (rosVizFlagLocked) {
        return;
      }
      setFeatureFlag("rosViz", runtime === "rosViz");

      const nextProfile: ViewerProfile = runtime === "rosViz" ? "ros_debug" : "studio";
      if (!viewerProfileLocked) {
        setViewerProfile(nextProfile);
      }
      applyProfilePreset(nextProfile);
    },
    [applyProfilePreset, rosVizFlagLocked, viewerProfileLocked]
  );

  const handleViewerProfileChange = useCallback(
    (profile: ViewerProfile) => {
      if (viewerProfileLocked) {
        return;
      }
      setViewerProfile(profile);
      applyProfilePreset(profile);
    },
    [applyProfilePreset, viewerProfileLocked]
  );

  const togglePanel = useWorkspaceStore((state) => state.togglePanel);
  const panels = useWorkspaceStore((state) => state.panels);
  const mode = useWorkspaceStore((state) => state.mode);
  const setMode = useWorkspaceStore((state) => state.setMode);

  const rosVizRuntimeUnavailableReason = !rosVizGate.enabled
    ? rosVizGate.unavailableReason
    : webGpuSupported
      ? undefined
      : "WebGPU is unavailable in this browser/device.";

  const rendererRuntimeLockedReason = rosVizFlagLocked
    ? "Renderer is locked by URL flags. Remove '?flags=' override to change it."
    : undefined;

  const viewerProfileLockedReason = viewerProfileLocked
    ? "Viewer profile is locked by URL query (?viewerProfile=...)."
    : undefined;

  return {
    rendererRuntime: runtimeDecision.runtime,
    onRendererRuntimeChange: handleRendererRuntimeChange,
    rendererRuntimeLocked: rosVizFlagLocked,
    rendererRuntimeLockedReason,
    rosVizRuntimeAvailable: rosVizGate.enabled && webGpuSupported,
    rosVizRuntimeUnavailableReason,
    viewerProfile,
    viewerProfileSource,
    onViewerProfileChange: handleViewerProfileChange,
    viewerProfileLocked,
    viewerProfileLockedReason,
    mode,
    setMode: (nextMode: WorkspaceMode) => setMode(nextMode),
    displaysPanelOpen: panels.displays,
    runtimeHealthPanelOpen: panels.runtime_health,
    onToggleDisplaysPanel: () => togglePanel("displays"),
    onToggleRuntimeHealthPanel: () => togglePanel("runtime_health"),
  };
};
