import type { ComponentProps } from "react";
import { Suspense, lazy } from "react";

const MeshFilesStatusPanel = lazy(() =>
  import("@/features/layout/page/MeshFilesStatusPanel").then((module) => ({
    default: module.MeshFilesStatusPanel,
  }))
);
const ExportDialog = lazy(() =>
  import("@/features/dataset/ExportDialog").then((module) => ({ default: module.ExportDialog }))
);
const PovCamerasOverlay = lazy(() =>
  import("@/features/layout/page/PovCamerasOverlay").then((module) => ({
    default: module.PovCamerasOverlay,
  }))
);
const LoadIssuesPanel = lazy(() =>
  import("@/features/layout/page/LoadIssuesPanel").then((module) => ({
    default: module.LoadIssuesPanel,
  }))
);

type PageOverlaysProps = {
  meshFilesStatusPanelProps: ComponentProps<
    typeof import("@/features/layout/page/MeshFilesStatusPanel").MeshFilesStatusPanel
  >;
  exportDialogProps: ComponentProps<typeof import("@/features/dataset/ExportDialog").ExportDialog>;
  povCamerasOverlayProps: ComponentProps<
    typeof import("@/features/layout/page/PovCamerasOverlay").PovCamerasOverlay
  >;
  loadIssuesPanelProps: ComponentProps<
    typeof import("@/features/layout/page/LoadIssuesPanel").LoadIssuesPanel
  >;
};

export const PageOverlays = ({
  meshFilesStatusPanelProps,
  exportDialogProps,
  povCamerasOverlayProps,
  loadIssuesPanelProps,
}: PageOverlaysProps) => (
  <Suspense fallback={null}>
    <LoadIssuesPanel {...loadIssuesPanelProps} />
    <MeshFilesStatusPanel {...meshFilesStatusPanelProps} />
    <ExportDialog {...exportDialogProps} />
    <PovCamerasOverlay {...povCamerasOverlayProps} />
  </Suspense>
);
