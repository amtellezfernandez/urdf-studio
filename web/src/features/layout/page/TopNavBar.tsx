import { Bug } from "lucide-react";
import { Link } from "react-router-dom";

import { TOP_NAV_HEIGHT } from "@/features/layout/page/constants";
import { FileUtilsMenus } from "@/features/layout/page/top-nav/FileUtilsMenus";
import { WorldsMenu } from "@/features/layout/page/top-nav/WorldsMenu";
import { ViewMenu } from "@/features/layout/page/top-nav/ViewMenu";
import { DatasetMenu } from "@/features/layout/page/top-nav/DatasetMenu";
import { CreateMenu } from "@/features/layout/page/top-nav/CreateMenu";
import { IkMenu } from "@/features/layout/page/top-nav/IkMenu";
import { CollaborationMenu } from "@/features/layout/page/top-nav/CollaborationMenu";
import type { TopNavBarProps } from "@/features/layout/page/top-nav/types";
import {
  getWorkspaceModeUiPolicy,
} from "@/features/layout/page/workspaceModeUi";

export const TopNavBar = (props: TopNavBarProps) => {
  const logoUrl = `${import.meta.env.BASE_URL}assets/urdf-studio-logo.png`;
  const workspaceModeUi = getWorkspaceModeUiPolicy(props.workspaceMode);
  const teleopConnectionButtonClassName = (
    connected: boolean | undefined,
    open: boolean | undefined,
  ): string =>
    connected
      ? "border-emerald-500/35 bg-emerald-500/10 text-foreground"
      : open
        ? "border-border/70 bg-muted/30 text-foreground"
        : "border-border/70 bg-background/50 text-muted-foreground hover:bg-muted/40 hover:text-foreground";

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 border-b border-[#3d3d3d] bg-[#282828] px-1 flex items-center"
      style={{ height: TOP_NAV_HEIGHT }}
    >
      <Link
        to="/"
        aria-label="Go to home page"
        title="Go to home page"
        className="ml-1 mr-2 inline-flex h-7 shrink-0 items-center sm:mr-3"
        onClick={props.onGoHome}
      >
        <img
          src={logoUrl}
          alt="URDF Studio"
          className="h-5 w-auto object-contain"
        />
      </Link>

      <div className="flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden">
        {props.showMenus ? (
          <>
            <FileUtilsMenus
              showAssemblyExportAction={workspaceModeUi.showAssemblyActions}
              onExportAssemblyUrdf={props.onExportAssemblyUrdf}
              openExportDialog={props.openExportDialog}
              onSave={props.onSave}
              onRevert={props.onRevert}
              canRevert={props.canRevert}
              onResetRotation={props.onResetRotation}
              hasRotationChanges={props.hasRotationChanges}
              onCanonicalOrder={props.onCanonicalOrder}
              onPrettyPrint={props.onPrettyPrint}
              onNormalizeAxes={props.onNormalizeAxes}
              onFixMeshPaths={props.onFixMeshPaths}
              rotationAxis={props.rotationAxis}
              setRotationAxis={props.setRotationAxis}
              onRotateRobot={props.onRotateRobot}
            />

            {workspaceModeUi.showStudioChrome ? (
              <WorldsMenu
                onExportCurrentWorldSceneLayer={props.onExportCurrentWorldSceneLayer}
                onImportSceneLayerFromUrl={props.onImportSceneLayerFromUrl}
                onImportBlenderLayoutChangeSet={props.onImportBlenderLayoutChangeSet}
                onExportCurrentWorldScenePackage={props.onExportCurrentWorldScenePackage}
                onImportWorldScenePackage={props.onImportWorldScenePackage}
                onValidateCurrentWorldScenePackage={props.onValidateCurrentWorldScenePackage}
                onPublishCurrentWorldScenePackage={props.onPublishCurrentWorldScenePackage}
                onListWorldScenePackages={props.onListWorldScenePackages}
                onExportWorldRolloutCampaign={props.onExportWorldRolloutCampaign}
                onRunLocalWorldRollout={props.onRunLocalWorldRollout}
                onImportWorldRolloutResults={props.onImportWorldRolloutResults}
                onOpenWorldRolloutReview={props.onOpenWorldRolloutReview}
                exportCamerasAsJSON={props.exportCamerasAsJSON}
                hasCamerasToExport={props.hasCamerasToExport}
                setShowCameraUpload={props.setShowCameraUpload}
              />
            ) : null}

            {workspaceModeUi.showStudioChrome ? (
              <ViewMenu
                minimalMode={false}
                angleUnit={props.angleUnit}
                setAngleUnit={props.setAngleUnit}
                rendererRuntime={props.rendererRuntime}
                onRendererRuntimeChange={props.onRendererRuntimeChange}
                rendererRuntimeLocked={props.rendererRuntimeLocked}
                rendererRuntimeLockedReason={props.rendererRuntimeLockedReason}
                rosVizRuntimeAvailable={props.rosVizRuntimeAvailable}
                rosVizRuntimeUnavailableReason={props.rosVizRuntimeUnavailableReason}
                viewerProfile={props.viewerProfile}
                onViewerProfileChange={props.onViewerProfileChange}
                viewerProfileLocked={props.viewerProfileLocked}
                viewerProfileLockedReason={props.viewerProfileLockedReason}
                displaysPanelOpen={props.displaysPanelOpen}
                runtimeHealthPanelOpen={props.runtimeHealthPanelOpen}
                onToggleDisplaysPanel={props.onToggleDisplaysPanel}
                onToggleRuntimeHealthPanel={props.onToggleRuntimeHealthPanel}
                gpuMode={props.gpuMode}
                setGPUMode={props.setGPUMode}
                collisionsVisible={props.collisionsVisible}
                setCollisionsVisible={props.setCollisionsVisible}
                showUrdfEditor={props.showUrdfEditor}
                setShowUrdfEditor={props.setShowUrdfEditor}
                urdfViewMode={props.urdfViewMode}
                setUrdfViewMode={props.setUrdfViewMode}
                showPovCameras={props.showPovCameras}
                setShowPovCameras={props.setShowPovCameras}
                inertialVisualization={props.inertialVisualization}
                setInertialVisualization={props.setInertialVisualization}
              />
            ) : null}

            {workspaceModeUi.showStudioChrome ? (
              <DatasetMenu
                openMappingList={props.openMappingList}
                datasetActions={props.datasetActions}
                onOpenDatasetReview={props.onOpenDatasetReview}
              />
            ) : null}

            {workspaceModeUi.showStudioChrome ? (
              <CreateMenu
                openObjectCreator={props.openObjectCreator}
                setShowCameraCreator={props.setShowCameraCreator}
              />
            ) : null}

            {workspaceModeUi.showStudioChrome ? (
              <IkMenu
                isIkPanelOpen={props.isIkPanelOpen}
                onOpenIkPanel={props.onOpenIkPanel}
                selectedIkSolverId={props.selectedIkSolverId}
                ikSolverOptions={props.ikSolverOptions}
                onSelectIkSolver={props.onSelectIkSolver}
              />
            ) : null}
          </>
        ) : null}
      </div>
      <div className="ml-1 flex shrink-0 items-center gap-1 sm:gap-2">
        {workspaceModeUi.showStudioChrome && props.onOpenTrainingMode ? (
          <button
            type="button"
            className="h-7 shrink-0 rounded-md border border-border/70 bg-background/50 px-2 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground sm:px-2.5"
            onClick={props.onOpenTrainingMode}
            aria-label="URDF Ops"
            title="Open URDF Ops training workspace"
          >
            <span className="sm:hidden">Ops</span>
            <span className="hidden sm:inline">URDF Ops</span>
          </button>
        ) : null}
        {workspaceModeUi.showStudioChrome && props.simulationPrepStatusLabel && props.onOpenSimulationPrep ? (
          <button
            type="button"
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-background/45 px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/35 hover:text-foreground sm:px-2"
            onClick={props.onOpenSimulationPrep}
            aria-label="Open simulator"
            title={`Simulator: ${props.simulationPrepStatusLabel}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                props.simulationPrepNeedsAttention ? "bg-amber-300/90" : "bg-emerald-300/80"
              }`}
            />
            <span className="font-medium text-foreground">
              <span className="sm:hidden">Sim</span>
              <span className="hidden sm:inline">Simulator</span>
            </span>
          </button>
        ) : null}
        {workspaceModeUi.showStudioChrome &&
        (props.onToggleLeaderInputPanel ||
          props.onToggleFollowerHardwarePanel ||
          props.onToggleTeleopPanel) ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={`h-7 shrink-0 rounded-md border px-1.5 text-xs sm:px-2 ${teleopConnectionButtonClassName(
                props.leaderInputConnected,
                props.leaderInputPanelOpen || props.teleopPanelOpen,
              )}`}
              onClick={props.onToggleLeaderInputPanel ?? props.onToggleTeleopPanel}
              title="Open leader input setup"
            >
              Leader
            </button>
            <button
              type="button"
              className={`h-7 shrink-0 rounded-md border px-1.5 text-xs sm:px-2 ${teleopConnectionButtonClassName(
                props.followerHardwareConnected,
                props.followerHardwarePanelOpen,
              )}`}
              onClick={props.onToggleFollowerHardwarePanel ?? props.onToggleTeleopPanel}
              title="Open follower hardware and cameras"
            >
              Follower
            </button>
          </div>
        ) : null}
        {workspaceModeUi.showStudioChrome && props.onCreateCollaborationLink ? (
          <CollaborationMenu
            collaborationOwner={props.collaborationOwner}
            collaborationPeerCount={props.collaborationPeerCount}
            collaborationInviteAction={props.collaborationInviteAction}
            collaborationSharingEnabled={props.collaborationSharingEnabled}
            collaborationStatus={props.collaborationStatus}
            onCreateCollaborationLink={props.onCreateCollaborationLink}
            onEmailCollaborationLink={props.onEmailCollaborationLink}
            onResetCollaborationLink={props.onResetCollaborationLink}
            onSetCollaborationSharingEnabled={props.onSetCollaborationSharingEnabled}
          />
        ) : null}
        {workspaceModeUi.showStudioChrome && props.studioIssueReportUrl ? (
          <a
            href={props.studioIssueReportUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open issue"
            title="Open issue"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/50 bg-background/25 text-muted-foreground/70 transition-colors hover:border-border/70 hover:bg-muted/25 hover:text-muted-foreground"
          >
            <Bug aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
        ) : null}
        {workspaceModeUi.isAssembly ? (
          <button
            type="button"
            className="h-7 rounded-md border border-border/70 bg-background/50 px-2.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            onClick={() => props.onWorkspaceModeChange("studio")}
          >
            Exit Assembly
          </button>
        ) : null}
      </div>
    </div>
  );
};
