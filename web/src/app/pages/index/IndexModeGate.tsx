import { Suspense } from "react";
import { ViewerHost } from "@/features/layout/page/ViewerHost";
import { LoadingScreen } from "@/features/layout/page/LoadingScreen";
import { Button } from "@/shared/ui/button";
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
  runtimePreviewLoadError: string | null;
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

const openStudioRoot = () => {
  if (typeof window === "undefined") return;
  window.location.assign(window.location.pathname || "/");
};

const RuntimePreviewErrorFrame = ({ message }: { message: string }) => (
  <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
    <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Runtime preview failed
        </p>
        <h1 className="text-xl font-semibold">Could not load the preview robot</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={openStudioRoot}>
          Open Studio
        </Button>
      </div>
    </div>
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
  runtimePreviewLoadError,
  runtimePreviewViewerProps,
  thumbnailMode,
  thumbnailViewerProps,
  urdfContentVersion,
  FolderUploadScreen,
}: IndexModeGateProps) => {
  if (!hasLoadedFiles) {
    if (runtimePreviewMode && runtimePreviewLoadError) {
      return <RuntimePreviewErrorFrame message={runtimePreviewLoadError} />;
    }

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
