import { Bug } from "lucide-react";
import { Link } from "react-router-dom";

import { TOP_NAV_HEIGHT } from "@/features/layout/page/constants";
import { FileUtilsMenus } from "@/features/layout/page/top-nav/FileUtilsMenus";
import { WorldsMenu } from "@/features/layout/page/top-nav/WorldsMenu";
import { ViewMenu } from "@/features/layout/page/top-nav/ViewMenu";
import { CreateMenu } from "@/features/layout/page/top-nav/CreateMenu";
import type { TopNavBarProps } from "@/features/layout/page/top-nav/types";
import { getWorkspaceModeUiPolicy } from "@/features/layout/page/workspaceModeUi";

type TopNavMenusProps = Pick<
  TopNavBarProps,
  | "angleUnit"
  | "collisionsVisible"
  | "displaysPanelOpen"
  | "exportCamerasAsJSON"
  | "gpuMode"
  | "hasCamerasToExport"
  | "hasRotationChanges"
  | "inertialVisualization"
  | "isPovCamerasOverlayOpen"
  | "onCanonicalOrder"
  | "onExportAssemblyUrdf"
  | "onExportCurrentWorldSceneLayer"
  | "onExportWorldRolloutCampaign"
  | "onFixMeshPaths"
  | "onImportSceneLayerFromUrl"
  | "onImportSplatBackground"
  | "onImportWorkspaceChangeSet"
  | "onImportWorldRolloutResults"
  | "onListWorldScenePackages"
  | "onOpenScenarios"
  | "onNormalizeAxes"
  | "onOpenCameraCreator"
  | "onOpenCameraUpload"
  | "onOpenPovCamerasOverlay"
  | "onOpenWorldRolloutReview"
  | "onPrettyPrint"
  | "onPublishCurrentWorldScenePackage"
  | "onRendererRuntimeChange"
  | "onResetRotation"
  | "onRevert"
  | "onRotateRobot"
  | "onRunLocalWorldRollout"
  | "onSave"
  | "onToggleDisplaysPanel"
  | "onToggleRuntimeHealthPanel"
  | "onViewerProfileChange"
  | "onValidateCurrentWorldScenePackage"
  | "openExportDialog"
  | "openObjectCreator"
  | "rendererRuntime"
  | "rendererRuntimeLocked"
  | "rendererRuntimeLockedReason"
  | "rosVizRuntimeAvailable"
  | "rosVizRuntimeUnavailableReason"
  | "rotationAxis"
  | "runtimeHealthPanelOpen"
  | "setAngleUnit"
  | "setCollisionsVisible"
  | "setGPUMode"
  | "setInertialVisualization"
  | "setRotationAxis"
  | "setShowUrdfEditor"
  | "setUrdfViewMode"
  | "showUrdfEditor"
  | "urdfViewMode"
  | "viewerProfile"
  | "viewerProfileLocked"
  | "viewerProfileLockedReason"
  | "workspaceMode"
> & {
  canRevert: boolean;
  showMenus: boolean;
  workspaceModeUi: ReturnType<typeof getWorkspaceModeUiPolicy>;
};

type TopNavUtilityActionsProps = Pick<
  TopNavBarProps,
  | "onGoHome"
  | "onOpenWorkspaceLauncher"
  | "onWorkspaceModeChange"
  | "studioIssueReportUrl"
  | "workspaceLauncherNeedsAttention"
  | "workspaceLauncherStatusLabel"
  | "workspaceMode"
> & {
  workspaceModeUi: ReturnType<typeof getWorkspaceModeUiPolicy>;
};

const TopNavMenus = ({
  canRevert,
  showMenus,
  workspaceModeUi,
  ...props
}: TopNavMenusProps) => {
  if (!showMenus) {
    return null;
  }

  const showStudioMenus = workspaceModeUi.showStudioChrome;

  return (
    <>
      <FileUtilsMenus
        showAssemblyExportAction={workspaceModeUi.showAssemblyActions}
        onExportAssemblyUrdf={props.onExportAssemblyUrdf}
        openExportDialog={props.openExportDialog}
        onSave={props.onSave}
        onRevert={props.onRevert}
        canRevert={canRevert}
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

      {showStudioMenus ? (
        <>
          <WorldsMenu
            onExportCurrentWorldSceneLayer={props.onExportCurrentWorldSceneLayer}
            onImportSceneLayerFromUrl={props.onImportSceneLayerFromUrl}
            onImportSplatBackground={props.onImportSplatBackground}
            onImportWorkspaceChangeSet={props.onImportWorkspaceChangeSet}
            onValidateCurrentWorldScenePackage={props.onValidateCurrentWorldScenePackage}
            onPublishCurrentWorldScenePackage={props.onPublishCurrentWorldScenePackage}
            onListWorldScenePackages={props.onListWorldScenePackages}
            onOpenScenarios={props.onOpenScenarios}
            onExportWorldRolloutCampaign={props.onExportWorldRolloutCampaign}
            onRunLocalWorldRollout={props.onRunLocalWorldRollout}
            onImportWorldRolloutResults={props.onImportWorldRolloutResults}
            onOpenWorldRolloutReview={props.onOpenWorldRolloutReview}
            exportCamerasAsJSON={props.exportCamerasAsJSON}
            hasCamerasToExport={props.hasCamerasToExport}
            onOpenCameraUpload={props.onOpenCameraUpload}
          />
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
            isPovCamerasOverlayOpen={props.isPovCamerasOverlayOpen}
            onOpenPovCamerasOverlay={props.onOpenPovCamerasOverlay}
            inertialVisualization={props.inertialVisualization}
            setInertialVisualization={props.setInertialVisualization}
          />
          <CreateMenu
            openObjectCreator={props.openObjectCreator}
            onOpenCameraCreator={props.onOpenCameraCreator}
          />
        </>
      ) : null}
    </>
  );
};

const TopNavUtilityActions = ({
  onOpenWorkspaceLauncher,
  onWorkspaceModeChange,
  studioIssueReportUrl,
  workspaceLauncherNeedsAttention,
  workspaceLauncherStatusLabel,
  workspaceModeUi,
}: TopNavUtilityActionsProps) => {
  const showStudioUtilities = workspaceModeUi.showStudioChrome;
  const showSimulationPrepButton =
    showStudioUtilities &&
    Boolean(workspaceLauncherStatusLabel && onOpenWorkspaceLauncher);
  const showIssueLink = showStudioUtilities && Boolean(studioIssueReportUrl);

  return (
    <div className="ml-1 flex shrink-0 items-center gap-1 sm:gap-2">
      {showSimulationPrepButton ? (
        <button
          type="button"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-background/45 px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/35 hover:text-foreground sm:px-2"
          onClick={onOpenWorkspaceLauncher}
          aria-label="Simulation Prep"
          title={`Simulation Prep: ${workspaceLauncherStatusLabel}`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${
              workspaceLauncherNeedsAttention
                ? "bg-amber-300/90"
                : "bg-emerald-300/80"
            }`}
          />
          <span className="font-medium text-foreground">
            <span className="sm:hidden">Prep</span>
            <span className="hidden sm:inline">Simulation Prep</span>
          </span>
        </button>
      ) : null}
      {showIssueLink ? (
        <a
          href={studioIssueReportUrl}
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
          onClick={() => onWorkspaceModeChange("studio")}
        >
          Exit Assembly
        </button>
      ) : null}
    </div>
  );
};

export const TopNavBar = (props: TopNavBarProps) => {
  const logoUrl = `${import.meta.env.BASE_URL}assets/urdf-studio-logo.png`;
  const workspaceModeUi = getWorkspaceModeUiPolicy(props.workspaceMode);

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
        <TopNavMenus
          {...props}
          canRevert={props.canRevert}
          showMenus={props.showMenus}
          workspaceModeUi={workspaceModeUi}
        />
      </div>
      <TopNavUtilityActions {...props} workspaceModeUi={workspaceModeUi} />
    </div>
  );
};
