import type { ComponentProps } from "react";
import { Suspense, lazy } from "react";

const MappingPanels = lazy(() =>
  import("@/app/pages/index/MappingPanels").then((module) => ({ default: module.MappingPanels }))
);
const CreationDialogs = lazy(() =>
  import("@/app/pages/index/CreationDialogs").then((module) => ({
    default: module.CreationDialogs,
  }))
);

type PageDialogsProps = {
  mappingPanelsProps: ComponentProps<typeof import("@/app/pages/index/MappingPanels").MappingPanels>;
  creationDialogsProps: ComponentProps<
    typeof import("@/app/pages/index/CreationDialogs").CreationDialogs
  >;
};

export const PageDialogs = ({ mappingPanelsProps, creationDialogsProps }: PageDialogsProps) => (
  <Suspense fallback={null}>
    <MappingPanels {...mappingPanelsProps} />
    <CreationDialogs {...creationDialogsProps} />
  </Suspense>
);
