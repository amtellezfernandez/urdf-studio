import type { ComponentProps } from "react";
import { PageShell, type PageShellProps } from "@/features/layout/page/PageShell";
import { PageOverlays } from "@/features/layout/page/PageOverlays";
import { PageDialogs } from "@/features/layout/page/PageDialogs";
import { WorkspacePanels } from "@/features/layout/page/WorkspacePanels";

export type PageLayoutProps = PageShellProps & {
  loadIssuesPanelProps: ComponentProps<
    typeof import("@/features/layout/page/LoadIssuesPanel").LoadIssuesPanel
  >;
  healthActionPanelProps: ComponentProps<
    typeof import("@/features/layout/page/HealthActionPanel").HealthActionPanel
  >;
  povCamerasOverlayProps: ComponentProps<
    typeof import("@/features/layout/page/PovCamerasOverlay").PovCamerasOverlay
  >;
  creationDialogsProps: ComponentProps<
    typeof import("@/features/layout/page/CreationDialogs").CreationDialogs
  >;
};

export const PageLayout = ({
  isLoading,
  topNavBarProps,
  leftSidebarProps,
  viewerLayoutProps,
  rightSidebarProps,
  urdfStatusBannerProps,
  loadIssuesPanelProps,
  healthActionPanelProps,
  povCamerasOverlayProps,
  creationDialogsProps,
}: PageLayoutProps) => (
  <div className="flex h-screen w-full overflow-hidden bg-background">
    <PageShell
      isLoading={isLoading}
      topNavBarProps={topNavBarProps}
      leftSidebarProps={leftSidebarProps}
      viewerLayoutProps={viewerLayoutProps}
      rightSidebarProps={rightSidebarProps}
      urdfStatusBannerProps={urdfStatusBannerProps}
    />
    <PageOverlays
      povCamerasOverlayProps={povCamerasOverlayProps}
      loadIssuesPanelProps={loadIssuesPanelProps}
      healthActionPanelProps={healthActionPanelProps}
    />
    <PageDialogs creationDialogsProps={creationDialogsProps} />
    <WorkspacePanels />
  </div>
);
