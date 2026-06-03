import { Suspense, lazy } from "react";
import { viewerPlayback } from "@/features/viewer/playback/viewerPlayback";
import { useViewerPlaybackStore } from "@/shared/store/useViewerPlaybackStore";
import { VIEWER_RESIZER_HEIGHT } from "@/features/layout/page/constants";
import { ViewerHost } from "@/features/layout/page/ViewerHost";
import { getWorkspaceModeUiPolicy } from "@/features/layout/page/workspaceModeUi";
import type { Viewer3DProps } from "@/features/viewer/Viewer3D";
import type { ViewerEpisode } from "@/shared/types/feature";
import type { DatasetConstraintSettings } from "@/features/dataset/episode-viewer/constraintSettings";
import type { WorkspaceMode } from "@/features/workspace/types";
import type { URDFRobot } from "urdf-loader";
import type * as THREE from "three";

const EpisodeViewer3DModal = lazy(() =>
  import("@/features/dataset/EpisodeViewer3DModal").then((module) => ({
    default: module.EpisodeViewer3DModal,
  }))
);

type WorkspaceViewerContentProps = {
  workspaceMode: WorkspaceMode;
  viewerKey: string;
  viewerProps: Viewer3DProps;
  showUrdfEditor: boolean;
  assemblyIssueReportUrl?: string;
  assemblyContactPairCount: number;
  assemblySecondaryModelsCount: number;
  primaryRobotName: string;
  recordingViewHeight: number;
  handleViewerResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  viewerEpisode: ViewerEpisode | null;
  onViewerOpenChange?: (open: boolean) => void;
  robotBoundingBox: THREE.Box3 | null;
  robot: URDFRobot | null;
  jointLimits: Viewer3DProps["jointLimits"];
  currentFrame: number;
  setCurrentFrame: (frame: number) => void;
  datasetConstraintSettings?: DatasetConstraintSettings;
  episodeSaveHandler?: (episode: ViewerEpisode, saveAsNew: boolean, newName?: string) => void;
};

export const WorkspaceViewerContent = ({
  workspaceMode,
  viewerKey,
  viewerProps,
  showUrdfEditor,
  assemblyIssueReportUrl,
  assemblyContactPairCount,
  assemblySecondaryModelsCount,
  primaryRobotName,
  recordingViewHeight,
  handleViewerResizeStart,
  viewerEpisode,
  onViewerOpenChange,
  robotBoundingBox,
  robot,
  jointLimits,
  currentFrame,
  setCurrentFrame,
  datasetConstraintSettings,
  episodeSaveHandler,
}: WorkspaceViewerContentProps) => {
  const workspaceModeUi = getWorkspaceModeUiPolicy(workspaceMode);
  const isPlaybackActive = useViewerPlaybackStore((state) => state.isPlaying);

  if (showUrdfEditor) {
    return (
      <ViewerHost
        viewerKey={viewerKey}
        viewerProps={viewerProps}
        fallbackClassName="h-full w-full bg-background"
      />
    );
  }

  if (workspaceModeUi.isAssembly) {
    return (
      <div className="h-full relative">
        <ViewerHost
          viewerKey={viewerKey}
          viewerProps={viewerProps}
          fallbackClassName="h-full w-full bg-background"
        />
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border/60 bg-background/85 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
          <div className="font-medium text-foreground">Assembly Workspace</div>
          <div className="mt-0.5">{`Loaded robots: ${1 + assemblySecondaryModelsCount}`}</div>
          <div className="mt-0.5">{`Contact pairs: ${assemblyContactPairCount}`}</div>
          <div className="max-w-[22rem] truncate">{primaryRobotName}</div>
          <div className="mt-1 text-[11px]">Drag robots on the floor. Ring overlap means contact.</div>
        </div>
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-sm border border-border/40 bg-background/85 px-2.5 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span>Assembly beta is experimental.</span>
            {assemblyIssueReportUrl ? (
              <a
                href={assemblyIssueReportUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-foreground/80 underline underline-offset-2 hover:text-foreground"
              >
                Open issue
              </a>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="min-h-0 border-b border-border/20"
        style={{ flex: `0 0 ${(1 - recordingViewHeight) * 100}%` }}
      >
        <ViewerHost
          viewerKey={viewerKey}
          viewerProps={viewerProps}
          fallbackClassName="h-full w-full bg-background"
        />
      </div>
      <div
        onPointerDown={handleViewerResizeStart}
        className="cursor-row-resize select-none bg-border/30 hover:bg-border/60 transition-colors relative group flex-shrink-0 z-10"
        style={{ height: VIEWER_RESIZER_HEIGHT }}
        aria-label="Resize viewer"
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-0.5 bg-border/40 group-hover:bg-border/80 transition-colors rounded-full" />
        </div>
      </div>
      <div
        className="min-h-0 overflow-hidden flex flex-col"
        style={{
          flex: `0 0 ${recordingViewHeight * 100}%`,
        }}
      >
        {viewerEpisode ? (
          <Suspense fallback={<div className="flex-1 min-h-0 bg-background" />}>
            <EpisodeViewer3DModal
              episode={viewerEpisode}
              open={true}
              onOpenChange={(open) => {
                if (!open) {
                  onViewerOpenChange?.(true);
                }
              }}
              robotBoundingBox={robotBoundingBox}
              robot={robot}
              jointLimits={jointLimits}
              inline={true}
              isPlayingAll={isPlaybackActive}
              globalCurrentFrame={currentFrame}
              onSetGlobalFrame={(frame: number) => {
                viewerPlayback.setFrame(frame);
                setCurrentFrame(frame);
              }}
              constraintSettings={datasetConstraintSettings}
              showOnlyHeader={recordingViewHeight <= 0.08}
              onSaveEpisode={episodeSaveHandler}
            />
          </Suspense>
        ) : (
          <div className="flex-1 min-h-0 flex items-center justify-center bg-background border-t border-border">
            <div className="flex flex-col items-center gap-3 text-center px-6">
              <div className="text-sm font-medium text-muted-foreground">Select an episode to inspect replay</div>
              <div className="text-xs text-muted-foreground/70 max-w-md">
                Use the episode list on the left, or record/import episodes to create a replay timeline.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
