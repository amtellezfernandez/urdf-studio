import type { ComponentProps } from "react";
import { Suspense, lazy } from "react";
import { LoadingScreen } from "@/features/layout/page/LoadingScreen";

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

type PageShellProps = {
  isLoading: boolean;
  topNavBarProps: ComponentProps<typeof import("@/features/layout/page/TopNavBar").TopNavBar>;
  leftSidebarProps: ComponentProps<typeof import("@/features/layout/page/LeftSidebarPanel").LeftSidebarPanel>;
  viewerLayoutProps: ComponentProps<typeof import("@/features/layout/page/ViewerLayout").ViewerLayout>;
  rightSidebarProps: ComponentProps<typeof import("@/features/layout/page/RightSidebarPanel").RightSidebarPanel>;
};

export const PageShell = ({
  isLoading,
  topNavBarProps,
  leftSidebarProps,
  viewerLayoutProps,
  rightSidebarProps,
}: PageShellProps) =>
  isLoading ? (
    <LoadingScreen />
  ) : (
    <Suspense fallback={<LoadingScreen />}>
      <TopNavBar {...topNavBarProps} />
      <LeftSidebarPanel {...leftSidebarProps} />
      <ViewerLayout {...viewerLayoutProps} />
      <RightSidebarPanel {...rightSidebarProps} />
    </Suspense>
  );
