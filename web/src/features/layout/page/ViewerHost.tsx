import { Suspense, useSyncExternalStore } from "react";

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
import { lazyNamedComponent } from "@/features/layout/page/workspacePanelsHelpers";
import { ViewerErrorBoundary } from "@/features/viewer/ViewerErrorBoundary";
import type { Viewer3DProps } from "@/features/viewer/Viewer3D";
import { NativeRobotViewer, type NativeRobotSource } from "@/features/layout/page/NativeRobotViewer";

const Viewer3D = lazyNamedComponent(
  () => import("@/features/viewer/Viewer3D"),
  "Viewer3D"
);
const RosVizViewer = lazyNamedComponent(
  () => import("@/studio_ui/rosviz/RosVizViewer"),
  "RosVizViewer"
);
const VIEWER_RUNTIME_PREFIXES = {
  rosViz: "rosviz",
  studio3d: "studio3d",
} as const;

type ViewerHostProps = {
  viewerKey: string;
  viewerProps: Viewer3DProps;
  nativeRobotSource?: NativeRobotSource | null;
  fallbackClassName?: string;
};

export const ViewerHost = ({
  viewerKey,
  viewerProps,
  nativeRobotSource = null,
  fallbackClassName = "h-full w-full bg-background",
}: ViewerHostProps) => {
  if (nativeRobotSource) {
    return <NativeRobotViewer source={nativeRobotSource} />;
  }
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

  const usesRosVizRuntime = runtimeDecision.runtime === "rosViz";
  const runtimePrefix = usesRosVizRuntime
    ? VIEWER_RUNTIME_PREFIXES.rosViz
    : VIEWER_RUNTIME_PREFIXES.studio3d;
  const ActiveViewer = usesRosVizRuntime ? RosVizViewer : Viewer3D;

  return (
    <Suspense fallback={<div className={fallbackClassName} />}>
      <ViewerErrorBoundary>
        <ActiveViewer key={`${runtimePrefix}-${viewerKey}`} {...viewerProps} />
      </ViewerErrorBoundary>
    </Suspense>
  );
};
