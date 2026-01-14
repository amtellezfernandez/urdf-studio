import type { ComponentProps } from "react";
import { Suspense, lazy } from "react";

const MeshFilesStatusPanel = lazy(() =>
  import("@/app/pages/index/MeshFilesStatusPanel").then((module) => ({
    default: module.MeshFilesStatusPanel,
  }))
);
const ExportDialog = lazy(() =>
  import("@/features/dataset/ExportDialog").then((module) => ({ default: module.ExportDialog }))
);
const PovCamerasOverlay = lazy(() =>
  import("@/app/pages/index/PovCamerasOverlay").then((module) => ({
    default: module.PovCamerasOverlay,
  }))
);

type PageOverlaysProps = {
  meshFilesStatusPanelProps: ComponentProps<
    typeof import("@/app/pages/index/MeshFilesStatusPanel").MeshFilesStatusPanel
  >;
  exportDialogProps: ComponentProps<typeof import("@/features/dataset/ExportDialog").ExportDialog>;
  povCamerasOverlayProps: ComponentProps<
    typeof import("@/app/pages/index/PovCamerasOverlay").PovCamerasOverlay
  >;
};

export const PageOverlays = ({
  meshFilesStatusPanelProps,
  exportDialogProps,
  povCamerasOverlayProps,
}: PageOverlaysProps) => (
  <Suspense fallback={null}>
    <MeshFilesStatusPanel {...meshFilesStatusPanelProps} />
    <ExportDialog {...exportDialogProps} />
    <PovCamerasOverlay {...povCamerasOverlayProps} />
  </Suspense>
);
