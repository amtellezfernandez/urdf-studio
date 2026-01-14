import type { ComponentProps } from "react";
import { TopNavBar } from "@/app/pages/index/TopNavBar";
import { LeftSidebarPanel } from "@/app/pages/index/LeftSidebarPanel";
import { ViewerLayout } from "@/app/pages/index/ViewerLayout";
import { RightSidebarPanel } from "@/app/pages/index/RightSidebarPanel";
import { MeshFilesStatusPanel } from "@/app/pages/index/MeshFilesStatusPanel";
import { ExportDialog } from "@/features/dataset/ExportDialog";
import { PovCamerasOverlay } from "@/app/pages/index/PovCamerasOverlay";
import { MappingPanels } from "@/app/pages/index/MappingPanels";
import { CreationDialogs } from "@/app/pages/index/CreationDialogs";
import { PageShell } from "@/app/pages/index/PageShell";
import { PageOverlays } from "@/app/pages/index/PageOverlays";
import { PageDialogs } from "@/app/pages/index/PageDialogs";

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
