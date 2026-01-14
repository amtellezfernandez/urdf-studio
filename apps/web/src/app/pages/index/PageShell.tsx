import type { ComponentProps } from "react";
import { Suspense, lazy } from "react";
import { LoadingScreen } from "@/app/pages/index/LoadingScreen";

const TopNavBar = lazy(() =>
  import("@/app/pages/index/TopNavBar").then((module) => ({ default: module.TopNavBar }))
);
const LeftSidebarPanel = lazy(() =>
  import("@/app/pages/index/LeftSidebarPanel").then((module) => ({ default: module.LeftSidebarPanel }))
);
const ViewerLayout = lazy(() =>
  import("@/app/pages/index/ViewerLayout").then((module) => ({ default: module.ViewerLayout }))
);
const RightSidebarPanel = lazy(() =>
  import("@/app/pages/index/RightSidebarPanel").then((module) => ({ default: module.RightSidebarPanel }))
);

type PageShellProps = {
  isLoading: boolean;
  topNavBarProps: ComponentProps<typeof import("@/app/pages/index/TopNavBar").TopNavBar>;
  leftSidebarProps: ComponentProps<typeof import("@/app/pages/index/LeftSidebarPanel").LeftSidebarPanel>;
  viewerLayoutProps: ComponentProps<typeof import("@/app/pages/index/ViewerLayout").ViewerLayout>;
  rightSidebarProps: ComponentProps<typeof import("@/app/pages/index/RightSidebarPanel").RightSidebarPanel>;
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
