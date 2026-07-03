import type { ComponentProps } from "react";
import { Profiler, Suspense, lazy, useCallback, type ReactNode } from "react";
import { LoadingScreen } from "@/features/layout/page/LoadingScreen";
import { ROBOT_LOADING_MESSAGE } from "@/features/layout/page/loadingScreenParams";
import { UrdfStatusBanner } from "@/features/layout/page/UrdfStatusBanner";
import { isMetricsEnabled } from "@/shared/lib/metrics";

const TopNavBar = lazy(() =>
  import("@/features/layout/page/TopNavBar").then((module) => ({ default: module.TopNavBar }))
);
const LeftSidebarPanel = lazy(() =>
  import("@/features/layout/page/LeftSidebarPanel").then((module) => ({ default: module.LeftSidebarPanel }))
);
const ViewerLayout = lazy(() =>
  import("@/features/layout/page/ViewerLayout").then((module) => ({ default: module.ViewerLayout }))
);
const RightSidebarPanel = lazy(() =>
  import("@/features/layout/page/RightSidebarPanel").then((module) => ({ default: module.RightSidebarPanel }))
);

export type PageShellProps = {
  isLoading: boolean;
  topNavBarProps: ComponentProps<typeof import("@/features/layout/page/TopNavBar").TopNavBar>;
  leftSidebarProps: ComponentProps<typeof import("@/features/layout/page/LeftSidebarPanel").LeftSidebarPanel>;
  viewerLayoutProps: ComponentProps<typeof import("@/features/layout/page/ViewerLayout").ViewerLayout>;
  rightSidebarProps: ComponentProps<typeof import("@/features/layout/page/RightSidebarPanel").RightSidebarPanel>;
  urdfStatusBannerProps: ComponentProps<
    typeof import("@/features/layout/page/UrdfStatusBanner").UrdfStatusBanner
  >;
};

export const PageShell = ({
  isLoading,
  topNavBarProps,
  leftSidebarProps,
  viewerLayoutProps,
  rightSidebarProps,
  urdfStatusBannerProps,
}: PageShellProps) => {
  const metricsEnabled =
    typeof window !== "undefined" && isMetricsEnabled(window, import.meta.env);
  const handleProfilerRender = useCallback(
    (
      id: string,
      phase: "mount" | "update",
      actualDuration: number,
      baseDuration: number,
      startTime: number,
      commitTime: number
    ) => {
      if (!metricsEnabled) return;
      console.debug(`[metrics] ui:${id}`, {
        phase,
        actualDurationMs: Number(actualDuration.toFixed(2)),
        baseDurationMs: Number(baseDuration.toFixed(2)),
        startTimeMs: Number(startTime.toFixed(2)),
        commitTimeMs: Number(commitTime.toFixed(2)),
      });
    },
    [metricsEnabled]
  );
  const withOptionalProfiler = useCallback(
    (id: string, node: ReactNode) =>
      metricsEnabled ? (
        <Profiler id={id} onRender={handleProfilerRender}>
          {node}
        </Profiler>
      ) : (
        node
      ),
    [handleProfilerRender, metricsEnabled]
  );

  return isLoading ? (
    <LoadingScreen message={ROBOT_LOADING_MESSAGE} />
  ) : (
    <Suspense fallback={<LoadingScreen />}>
      <TopNavBar {...topNavBarProps} />
      <UrdfStatusBanner {...urdfStatusBannerProps} />
      {withOptionalProfiler(
        "left-sidebar",
        <LeftSidebarPanel {...leftSidebarProps} />
      )}
      {withOptionalProfiler("viewer-layout", <ViewerLayout {...viewerLayoutProps} />)}
      {withOptionalProfiler(
        "right-sidebar",
        <RightSidebarPanel {...rightSidebarProps} />
      )}
    </Suspense>
  );
};
