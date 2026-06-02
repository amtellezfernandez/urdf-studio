import type { ComponentProps } from "react";
import { PageShell } from "@/features/layout/page/PageShell";
import { PageOverlays } from "@/features/layout/page/PageOverlays";
import { PageDialogs } from "@/features/layout/page/PageDialogs";
import { WorkspacePanels } from "@/features/layout/page/WorkspacePanels";

export type PageLayoutProps = {
  isLoading: boolean;
  topNavBarProps: ComponentProps<typeof import("@/features/layout/page/TopNavBar").TopNavBar>;
  leftSidebarProps: ComponentProps<typeof import("@/features/layout/page/LeftSidebarPanel").LeftSidebarPanel>;
  viewerLayoutProps: ComponentProps<typeof import("@/features/layout/page/ViewerLayout").ViewerLayout>;
  rightSidebarProps: ComponentProps<
    typeof import("@/features/layout/page/RightSidebarPanel").RightSidebarPanel
  >;
  urdfStatusBannerProps: ComponentProps<
    typeof import("@/features/layout/page/UrdfStatusBanner").UrdfStatusBanner
  >;
  loadIssuesPanelProps: ComponentProps<
    typeof import("@/features/layout/page/LoadIssuesPanel").LoadIssuesPanel
  >;
  healthActionPanelProps: ComponentProps<
    typeof import("@/features/layout/page/HealthActionPanel").HealthActionPanel
  >;
  exportDialogProps: ComponentProps<typeof import("@/features/dataset/ExportDialog").ExportDialog>;
  povCamerasOverlayProps: ComponentProps<
    typeof import("@/features/layout/page/PovCamerasOverlay").PovCamerasOverlay
  >;
  mappingPanelsProps: ComponentProps<
    typeof import("@/features/layout/page/MappingPanels").MappingPanels
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
  exportDialogProps,
  povCamerasOverlayProps,
  mappingPanelsProps,
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
      exportDialogProps={exportDialogProps}
      povCamerasOverlayProps={povCamerasOverlayProps}
      loadIssuesPanelProps={loadIssuesPanelProps}
      healthActionPanelProps={healthActionPanelProps}
    />
    <PageDialogs
      mappingPanelsProps={mappingPanelsProps}
      creationDialogsProps={creationDialogsProps}
    />
    <WorkspacePanels />
  </div>
);
