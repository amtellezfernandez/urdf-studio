import { useMemo } from "react";
import { toViewer3DProps } from "@/features/layout/page/viewer3DProps";
import type { PageLayoutProps } from "@/features/layout/page/PageLayout";

type UseIndexViewerPropsParams = {
  viewerLayoutProps: PageLayoutProps["viewerLayoutProps"];
};

export const useIndexViewerProps = ({ viewerLayoutProps }: UseIndexViewerPropsParams) => {
  const thumbnailViewerProps = useMemo(
    () =>
      toViewer3DProps({
        ...viewerLayoutProps,
        thumbnailMode: true,
      }),
    [viewerLayoutProps]
  );

  return {
    thumbnailViewerProps,
  };
};
