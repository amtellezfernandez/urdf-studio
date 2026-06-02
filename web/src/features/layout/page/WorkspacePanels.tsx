import { Suspense, lazy } from "react";

const DisplaysPanel = lazy(() =>
  import("@/features/layout/panels/DisplaysPanel").then((module) => ({
    default: module.DisplaysPanel,
  }))
);

const RuntimeHealthPanel = lazy(() =>
  import("@/features/layout/panels/RuntimeHealthPanel").then((module) => ({
    default: module.RuntimeHealthPanel,
  }))
);

export const WorkspacePanels = () => (
  <Suspense fallback={null}>
    <DisplaysPanel />
    <RuntimeHealthPanel />
  </Suspense>
);
