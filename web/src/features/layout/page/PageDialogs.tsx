import type { ComponentProps } from "react";
import { Suspense, lazy } from "react";

const CreationDialogs = lazy(() =>
  import("@/features/layout/page/CreationDialogs").then((module) => ({
    default: module.CreationDialogs,
  }))
);

type PageDialogsProps = {
  creationDialogsProps: ComponentProps<
    typeof import("@/features/layout/page/CreationDialogs").CreationDialogs
  >;
};

export const PageDialogs = ({ creationDialogsProps }: PageDialogsProps) => (
  <Suspense fallback={null}>
    <CreationDialogs {...creationDialogsProps} />
  </Suspense>
);
