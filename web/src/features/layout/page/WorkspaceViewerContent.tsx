import { ViewerHost } from "@/features/layout/page/ViewerHost";
import { getWorkspaceModeUiPolicy } from "@/features/layout/page/workspaceModeUi";
import type { Viewer3DProps } from "@/features/viewer/Viewer3D";
import type { WorkspaceMode } from "@/features/workspace/types";

type WorkspaceViewerContentProps = {
  workspaceMode: WorkspaceMode;
  viewerKey: string;
  viewerProps: Viewer3DProps;
  showUrdfEditor: boolean;
  assemblyIssueReportUrl?: string;
  assemblyContactPairCount: number;
  assemblySecondaryModelsCount: number;
  primaryRobotName: string;
  jointLimits: Viewer3DProps["jointLimits"];
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
  jointLimits,
}: WorkspaceViewerContentProps) => {
  const workspaceModeUi = getWorkspaceModeUiPolicy(workspaceMode);
  void jointLimits;

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
    <ViewerHost
      viewerKey={viewerKey}
      viewerProps={viewerProps}
      fallbackClassName="h-full w-full bg-background"
    />
  );
};
