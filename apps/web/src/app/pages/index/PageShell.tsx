import type { ComponentProps } from "react";
import { TopNavBar } from "@/app/pages/index/TopNavBar";
import { LeftSidebarPanel } from "@/app/pages/index/LeftSidebarPanel";
import { ViewerLayout } from "@/app/pages/index/ViewerLayout";
import { RightSidebarPanel } from "@/app/pages/index/RightSidebarPanel";
import { LoadingScreen } from "@/app/pages/index/LoadingScreen";

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
