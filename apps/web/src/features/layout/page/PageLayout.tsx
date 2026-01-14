import type { ComponentProps } from "react";
import { TopNavBar } from "@/features/layout/page/TopNavBar";
import { LeftSidebarPanel } from "@/features/layout/page/LeftSidebarPanel";
import { ViewerLayout } from "@/features/layout/page/ViewerLayout";
import { RightSidebarPanel } from "@/features/layout/page/RightSidebarPanel";
import { MeshFilesStatusPanel } from "@/features/layout/page/MeshFilesStatusPanel";
import { ExportDialog } from "@/features/dataset/ExportDialog";
import { PovCamerasOverlay } from "@/features/layout/page/PovCamerasOverlay";
import { MappingPanels } from "@/features/layout/page/MappingPanels";
import { CreationDialogs } from "@/features/layout/page/CreationDialogs";
import { PageShell } from "@/features/layout/page/PageShell";
import { PageOverlays } from "@/features/layout/page/PageOverlays";
import { PageDialogs } from "@/features/layout/page/PageDialogs";

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
