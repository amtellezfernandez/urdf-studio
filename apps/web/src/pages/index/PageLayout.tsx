import type { ComponentProps } from "react";
import { TopNavBar } from "@/pages/index/TopNavBar";
import { LeftSidebarPanel } from "@/pages/index/LeftSidebarPanel";
import { ViewerLayout } from "@/pages/index/ViewerLayout";
import { RightSidebarPanel } from "@/pages/index/RightSidebarPanel";
import { MeshFilesStatusPanel } from "@/pages/index/MeshFilesStatusPanel";
import { ExportDialog } from "@/components/ExportDialog";
import { PovCamerasOverlay } from "@/pages/index/PovCamerasOverlay";
import { MappingPanels } from "@/pages/index/MappingPanels";
import { CreationDialogs } from "@/pages/index/CreationDialogs";
import { PageShell } from "@/pages/index/PageShell";
import { PageOverlays } from "@/pages/index/PageOverlays";
import { PageDialogs } from "@/pages/index/PageDialogs";

type PageLayoutProps = {
  isLoading: boolean;
  topNavBarProps: ComponentProps<typeof TopNavBar>;
  leftSidebarProps: ComponentProps<typeof LeftSidebarPanel>;
  viewerLayoutProps: ComponentProps<typeof ViewerLayout>;
  rightSidebarProps: ComponentProps<typeof RightSidebarPanel>;
  meshFilesStatusPanelProps: ComponentProps<typeof MeshFilesStatusPanel>;
  exportDialogProps: ComponentProps<typeof ExportDialog>;
  povCamerasOverlayProps: ComponentProps<typeof PovCamerasOverlay>;
  mappingPanelsProps: ComponentProps<typeof MappingPanels>;
  creationDialogsProps: ComponentProps<typeof CreationDialogs>;
};

export const PageLayout = ({
  isLoading,
  topNavBarProps,
  leftSidebarProps,
  viewerLayoutProps,
  rightSidebarProps,
  meshFilesStatusPanelProps,
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
    />
    <PageOverlays
      meshFilesStatusPanelProps={meshFilesStatusPanelProps}
      exportDialogProps={exportDialogProps}
      povCamerasOverlayProps={povCamerasOverlayProps}
    />
    <PageDialogs
      mappingPanelsProps={mappingPanelsProps}
      creationDialogsProps={creationDialogsProps}
    />
  </div>
);
