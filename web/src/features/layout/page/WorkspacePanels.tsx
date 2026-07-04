import { Suspense } from "react";
import { lazyNamedComponent } from "@/features/layout/page/workspacePanelsHelpers";

const DisplaysPanel = lazyNamedComponent(
  () => import("@/features/layout/panels/DisplaysPanel"),
  "DisplaysPanel"
);

const RuntimeHealthPanel = lazyNamedComponent(
  () => import("@/features/layout/panels/RuntimeHealthPanel"),
  "RuntimeHealthPanel"
);

export const WorkspacePanels = () => (
  <Suspense fallback={null}>
    <DisplaysPanel />
    <RuntimeHealthPanel />
  </Suspense>
);
