import type { ComponentProps } from "react";

export type LoadIssuesPanelProps = ComponentProps<
  typeof import("@/features/layout/page/LoadIssuesPanel").LoadIssuesPanel
>;

export type HealthActionPanelProps = ComponentProps<
  typeof import("@/features/layout/page/HealthActionPanel").HealthActionPanel
>;

export type PovCamerasOverlayProps = ComponentProps<
  typeof import("@/features/layout/page/PovCamerasOverlay").PovCamerasOverlay
>;
