import { Suspense } from "react";
import { ViewerHost } from "@/features/layout/page/ViewerHost";
import { LoadingScreen } from "@/features/layout/page/LoadingScreen";
import type { Viewer3DProps } from "@/features/viewer/Viewer3D";
import type { SourceEntryActions } from "@/app/pages/index/sourceEntryTypes";

type IndexModeGateProps = {
  demoMode: boolean;
  hasLoadedFiles: boolean;
  isAttachingIluSession: boolean;
  loadFilesFromFolderWithFreshCameras: SourceEntryActions["onFolderSelected"];
  onLoadGitHubSource: SourceEntryActions["onGitHubSelected"];
  onLoadUrlSource: SourceEntryActions["onUrlSelected"];
  onImportWorldLayout: SourceEntryActions["onImportWorldLayout"];
  onOpenWorldOnlyWorkspace: SourceEntryActions["onOpenWorldOnlyWorkspace"];
  onPlayDemoMotion: SourceEntryActions["onPlayDemoMotion"];
  thumbnailMode: boolean;
  thumbnailViewerProps: Viewer3DProps;
  urdfContentVersion: number;
  FolderUploadScreen: React.ComponentType<SourceEntryActions>;
};

const LoadingScreenFrame = () => (
  <div className="min-h-screen bg-background text-foreground flex">
    <LoadingScreen />
  </div>
);

export const IndexModeGate = ({
  demoMode,
  hasLoadedFiles,
  isAttachingIluSession,
  loadFilesFromFolderWithFreshCameras,
  onLoadGitHubSource,
  onLoadUrlSource,
  onImportWorldLayout,
  onOpenWorldOnlyWorkspace,
  onPlayDemoMotion,
  thumbnailMode,
  thumbnailViewerProps,
  urdfContentVersion,
  FolderUploadScreen,
}: IndexModeGateProps) => {
  if (!hasLoadedFiles) {
    if (isAttachingIluSession || demoMode) {
      return <LoadingScreenFrame />;
    }

    return (
      <Suspense fallback={<LoadingScreenFrame />}>
        <FolderUploadScreen
          onFolderSelected={loadFilesFromFolderWithFreshCameras}
          onGitHubSelected={onLoadGitHubSource}
          onUrlSelected={onLoadUrlSource}
          onPlayDemoMotion={onPlayDemoMotion}
          onImportWorldLayout={onImportWorldLayout}
          onOpenWorldOnlyWorkspace={onOpenWorldOnlyWorkspace}
        />
      </Suspense>
    );
  }

  if (thumbnailMode) {
    return (
      <div className="h-screen w-screen bg-transparent">
        <ViewerHost
          viewerKey={`thumbnail-${urdfContentVersion}`}
          viewerProps={thumbnailViewerProps}
          fallbackClassName="h-full w-full bg-transparent"
        />
      </div>
    );
  }

  return null;
};
