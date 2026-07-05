import type { ComponentProps } from "react";
import { Suspense, lazy } from "react";
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
const HealthActionPanel = lazy(() =>
  import("@/features/layout/page/HealthActionPanel").then((module) => ({
    default: module.HealthActionPanel,
  }))
);

export type PageOverlaysProps = {
  povCamerasOverlayProps: ComponentProps<
    typeof import("@/features/layout/page/PovCamerasOverlay").PovCamerasOverlay
  >;
  loadIssuesPanelProps: ComponentProps<
    typeof import("@/features/layout/page/LoadIssuesPanel").LoadIssuesPanel
  >;
  healthActionPanelProps: ComponentProps<
    typeof import("@/features/layout/page/HealthActionPanel").HealthActionPanel
  >;
};

export const PageOverlays = ({
  povCamerasOverlayProps,
  loadIssuesPanelProps,
  healthActionPanelProps,
}: PageOverlaysProps) => (
  <Suspense fallback={null}>
    <HealthActionPanel {...healthActionPanelProps} />
    <LoadIssuesPanel {...loadIssuesPanelProps} />
    <PovCamerasOverlay {...povCamerasOverlayProps} />
  </Suspense>
);
