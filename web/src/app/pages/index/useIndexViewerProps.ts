import { useMemo } from "react";
import { toViewer3DProps } from "@/features/layout/page/viewer3DProps";
import type { PageLayoutProps } from "@/features/layout/page/PageLayout";
import { SELECT_RUNTIME_OBJECT_MESSAGE_TYPE } from "@/shared/contracts/previewBridge";

type UseIndexViewerPropsParams = {
  effectiveRuntimePose: PageLayoutProps["viewerLayoutProps"]["runtimeRobotBasePose"];
  viewerLayoutProps: PageLayoutProps["viewerLayoutProps"];
};

export const useIndexViewerProps = ({
  effectiveRuntimePose,
  viewerLayoutProps,
}: UseIndexViewerPropsParams) => {
  const thumbnailViewerProps = useMemo(
    () =>
      toViewer3DProps({
        ...viewerLayoutProps,
        thumbnailMode: true,
      }),
    [viewerLayoutProps]
  );

  const runtimePreviewViewerProps = useMemo(
    () =>
      toViewer3DProps({
        ...viewerLayoutProps,
        readOnlyMode: true,
        runtimeRobotBasePose: effectiveRuntimePose,
        workspaceMode: "studio",
        thumbnailMode: false,
        preferStudioRuntime: true,
        enableObjectActionsInReadOnly: true,
        onObjectSelect: (_objectId, object) => {
          if (typeof window === "undefined" || window.parent === window) {
            return;
          }
          window.parent.postMessage(
            {
              type: SELECT_RUNTIME_OBJECT_MESSAGE_TYPE,
              requestId: String(Date.now()),
              label: object?.label ?? null,
            },
            window.location.origin
          );
        },
      }),
    [effectiveRuntimePose, viewerLayoutProps]
  );

  return {
    runtimePreviewViewerProps,
    thumbnailViewerProps,
  };
};
