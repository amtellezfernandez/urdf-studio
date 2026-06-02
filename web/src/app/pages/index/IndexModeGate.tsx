import { Suspense } from "react";
import { ViewerHost } from "@/features/layout/page/ViewerHost";
import { LoadingScreen } from "@/features/layout/page/LoadingScreen";
import type { Viewer3DProps } from "@/features/viewer/Viewer3D";
import type { WorkspaceMode } from "@/features/workspace/types";

type IndexModeGateProps = {
  demoMode: boolean;
  hasLoadedFiles: boolean;
  isAttachingIluSession: boolean;
  loadFilesFromFolderWithFreshCameras: (fileList: FileList, options?: { preserveCameras?: boolean }) => Promise<void>;
  onImportWorldLayout: (worldLayoutUrl: string) => Promise<void>;
  onOpenTrainingMode: () => void;
  onPlayDemoMotion: () => void | Promise<void>;
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: string) => void;
  runtimePreviewMode: boolean;
  runtimePreviewViewerProps: Viewer3DProps;
  thumbnailMode: boolean;
  thumbnailViewerProps: Viewer3DProps;
  urdfContentVersion: number;
  FolderUploadScreen: React.ComponentType<{
    onFolderSelected: (fileList: FileList, options?: { preserveCameras?: boolean }) => Promise<void>;
    onPlayDemoMotion: () => void | Promise<void>;
    onImportWorldLayout: (worldLayoutUrl: string) => Promise<void>;
    onOpenTrainingMode: () => void;
    workspaceMode: WorkspaceMode;
    onWorkspaceModeChange: (mode: string) => void;
  }>;
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
  onImportWorldLayout,
  onOpenTrainingMode,
  onPlayDemoMotion,
  workspaceMode,
  onWorkspaceModeChange,
  runtimePreviewMode,
  runtimePreviewViewerProps,
  thumbnailMode,
  thumbnailViewerProps,
  urdfContentVersion,
  FolderUploadScreen,
}: IndexModeGateProps) => {
  if (!hasLoadedFiles) {
    if (isAttachingIluSession || runtimePreviewMode || demoMode) {
      return <LoadingScreenFrame />;
    }

    return (
      <Suspense fallback={<LoadingScreenFrame />}>
        <FolderUploadScreen
          onFolderSelected={loadFilesFromFolderWithFreshCameras}
          onPlayDemoMotion={onPlayDemoMotion}
          onImportWorldLayout={onImportWorldLayout}
          onOpenTrainingMode={onOpenTrainingMode}
          workspaceMode={workspaceMode}
          onWorkspaceModeChange={onWorkspaceModeChange}
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

  if (runtimePreviewMode) {
    return (
      <div className="h-screen w-screen bg-background">
        <ViewerHost
          viewerKey={`runtime-preview-${urdfContentVersion}`}
          viewerProps={runtimePreviewViewerProps}
          fallbackClassName="h-full w-full bg-background"
        />
      </div>
    );
  }

  return null;
};
