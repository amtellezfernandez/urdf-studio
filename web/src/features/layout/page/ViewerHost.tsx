import { Suspense, lazy, useSyncExternalStore } from "react";

import {
  canUseWebGpu,
  getRosVizRuntimeDecision,
} from "@/runtime_engine/rosviz/session/runtimeSelector";
import { FEATURE_GATES } from "@/shared/config/featureGates";
import {
  isFeatureFlagEnabled,
  subscribeFeatureFlags,
} from "@/shared/config/featureFlags";
import { useFeatureGateAvailability } from "@/shared/lib/featureGateUi";
import { ViewerErrorBoundary } from "@/features/viewer/ViewerErrorBoundary";
import type { Viewer3DProps } from "@/features/viewer/Viewer3D";

const Viewer3D = lazy(() =>
  import("@/features/viewer/Viewer3D").then((module) => ({ default: module.Viewer3D }))
);
const RosVizViewer = lazy(() =>
  import("@/studio_ui/rosviz/RosVizViewer").then((module) => ({
    default: module.RosVizViewer,
  }))
);

type ViewerHostProps = {
  viewerKey: string;
  viewerProps: Viewer3DProps;
  fallbackClassName?: string;
};

export const ViewerHost = ({
  viewerKey,
  viewerProps,
  fallbackClassName = "h-full w-full bg-background",
}: ViewerHostProps) => {
  const rosVizFlagEnabled = useSyncExternalStore(
    subscribeFeatureFlags,
    () => isFeatureFlagEnabled("rosViz"),
    () => false
  );
  const rosVizGate = useFeatureGateAvailability(FEATURE_GATES.rosVizRuntime);
  const runtimeDecision = getRosVizRuntimeDecision({
    thumbnailMode: viewerProps.thumbnailMode,
    preferStudioRuntime: viewerProps.preferStudioRuntime,
    rosVizFlagEnabled,
    rosVizGateEnabled: rosVizGate.enabled,
    rosVizGateReason: rosVizGate.unavailableReason,
    webGpuSupported: canUseWebGpu(),
  });

  const runtimePrefix = runtimeDecision.runtime === "rosViz" ? "rosviz" : "studio3d";
  const ActiveViewer = runtimeDecision.runtime === "rosViz" ? RosVizViewer : Viewer3D;

  return (
    <Suspense fallback={<div className={fallbackClassName} />}>
      <ViewerErrorBoundary>
        <ActiveViewer key={`${runtimePrefix}-${viewerKey}`} {...viewerProps} />
      </ViewerErrorBoundary>
    </Suspense>
  );
};
