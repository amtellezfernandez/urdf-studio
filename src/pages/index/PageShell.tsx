import type { ComponentProps } from "react";
import { TopNavBar } from "@/pages/index/TopNavBar";
import { LeftSidebarPanel } from "@/pages/index/LeftSidebarPanel";
import { ViewerLayout } from "@/pages/index/ViewerLayout";
import { RightSidebarPanel } from "@/pages/index/RightSidebarPanel";
import { LoadingScreen } from "@/pages/index/LoadingScreen";

type PageShellProps = {
  isLoading: boolean;
  topNavBarProps: ComponentProps<typeof TopNavBar>;
  leftSidebarProps: ComponentProps<typeof LeftSidebarPanel>;
  viewerLayoutProps: ComponentProps<typeof ViewerLayout>;
  rightSidebarProps: ComponentProps<typeof RightSidebarPanel>;
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
    <>
      <TopNavBar {...topNavBarProps} />
      <LeftSidebarPanel {...leftSidebarProps} />
      <ViewerLayout {...viewerLayoutProps} />
      <RightSidebarPanel {...rightSidebarProps} />
    </>
  );
