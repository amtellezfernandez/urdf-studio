import type { ComponentProps } from "react";
import { Suspense, useCallback } from "react";
import { LoadingScreen } from "@/features/layout/page/LoadingScreen";
import { ROBOT_LOADING_MESSAGE } from "@/features/layout/page/loadingScreenParams";
import { UrdfStatusBanner } from "@/features/layout/page/UrdfStatusBanner";
import { renderWithOptionalProfiler } from "@/features/layout/page/pageShellHelpers";
import { lazyNamedComponent } from "@/features/layout/page/workspacePanelsHelpers";
import { isMetricsEnabled } from "@/shared/lib/metrics";

const TopNavBar = lazyNamedComponent(
  () => import("@/features/layout/page/TopNavBar"),
  "TopNavBar"
);
const LeftSidebarPanel = lazyNamedComponent(
  () => import("@/features/layout/page/LeftSidebarPanel"),
  "LeftSidebarPanel"
);
const ViewerLayout = lazyNamedComponent(
  () => import("@/features/layout/page/ViewerLayout"),
  "ViewerLayout"
);
const RightSidebarPanel = lazyNamedComponent(
  () => import("@/features/layout/page/RightSidebarPanel"),
  "RightSidebarPanel"
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

  return isLoading ? (
    <LoadingScreen message={ROBOT_LOADING_MESSAGE} />
  ) : (
    <Suspense fallback={<LoadingScreen />}>
      <TopNavBar {...topNavBarProps} />
      <UrdfStatusBanner {...urdfStatusBannerProps} />
      {renderWithOptionalProfiler({
        enabled: metricsEnabled,
        id: "left-sidebar",
        node: <LeftSidebarPanel {...leftSidebarProps} />,
        onRender: handleProfilerRender,
      })}
      {renderWithOptionalProfiler({
        enabled: metricsEnabled,
        id: "viewer-layout",
        node: <ViewerLayout {...viewerLayoutProps} />,
        onRender: handleProfilerRender,
      })}
      {renderWithOptionalProfiler({
        enabled: metricsEnabled,
        id: "right-sidebar",
        node: <RightSidebarPanel {...rightSidebarProps} />,
        onRender: handleProfilerRender,
      })}
    </Suspense>
  );
};
