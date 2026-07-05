import { PageShell, type PageShellProps } from "@/features/layout/page/PageShell";
import { PageOverlays } from "@/features/layout/page/PageOverlays";
import { PageDialogs, type PageDialogsProps } from "@/features/layout/page/PageDialogs";
import { WorkspacePanels } from "@/features/layout/page/WorkspacePanels";
import type { LoadIssuesPanelProps } from "@/features/layout/page/pageLayoutTypes";
import type { HealthActionPanelProps } from "@/features/layout/page/pageLayoutTypes";
import type { PovCamerasOverlayProps } from "@/features/layout/page/pageLayoutTypes";

export type PageLayoutProps = PageShellProps & {
  creationDialogsProps: PageDialogsProps["creationDialogsProps"];
  healthActionPanelProps: HealthActionPanelProps;
  loadIssuesPanelProps: LoadIssuesPanelProps;
  povCamerasOverlayProps: PovCamerasOverlayProps;
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
