import type { ComponentProps } from "react";
import { MeshFilesStatusPanel } from "@/app/pages/index/MeshFilesStatusPanel";
import { ExportDialog } from "@/features/dataset/ExportDialog";
import { PovCamerasOverlay } from "@/app/pages/index/PovCamerasOverlay";

type PageOverlaysProps = {
  meshFilesStatusPanelProps: ComponentProps<typeof MeshFilesStatusPanel>;
  exportDialogProps: ComponentProps<typeof ExportDialog>;
  povCamerasOverlayProps: ComponentProps<typeof PovCamerasOverlay>;
};

export const PageOverlays = ({
  meshFilesStatusPanelProps,
  exportDialogProps,
  povCamerasOverlayProps,
}: PageOverlaysProps) => (
  <>
    <MeshFilesStatusPanel {...meshFilesStatusPanelProps} />
    <ExportDialog {...exportDialogProps} />
    <PovCamerasOverlay {...povCamerasOverlayProps} />
  </>
);
