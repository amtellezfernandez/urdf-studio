import type { ComponentProps } from "react";
import { Suspense, lazy } from "react";

const MappingPanels = lazy(() =>
  import("@/features/layout/page/MappingPanels").then((module) => ({ default: module.MappingPanels }))
);
const CreationDialogs = lazy(() =>
  import("@/features/layout/page/CreationDialogs").then((module) => ({
    default: module.CreationDialogs,
  }))
);

type PageDialogsProps = {
  mappingPanelsProps: ComponentProps<typeof import("@/features/layout/page/MappingPanels").MappingPanels>;
  creationDialogsProps: ComponentProps<
    typeof import("@/features/layout/page/CreationDialogs").CreationDialogs
  >;
};

export const PageDialogs = ({ mappingPanelsProps, creationDialogsProps }: PageDialogsProps) => (
  <Suspense fallback={null}>
    <MappingPanels {...mappingPanelsProps} />
    <CreationDialogs {...creationDialogsProps} />
  </Suspense>
);
