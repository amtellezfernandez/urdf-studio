import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import type { TopNavBarProps } from "./types";
import { menuContentClass, menuItemClass, menuTriggerClass } from "./menuStyles";

type WorldsMenuProps = Pick<
  TopNavBarProps,
  | "onExportCurrentWorldSceneLayer"
  | "onImportSceneLayerFromUrl"
  | "onImportWorkspaceChangeSet"
  | "onExportCurrentWorldScenePackage"
  | "onImportWorldScenePackage"
  | "onValidateCurrentWorldScenePackage"
  | "onPublishCurrentWorldScenePackage"
  | "onListWorldScenePackages"
  | "onExportWorldRolloutCampaign"
  | "onRunLocalWorldRollout"
  | "onImportWorldRolloutResults"
  | "onOpenWorldRolloutReview"
  | "exportCamerasAsJSON"
  | "hasCamerasToExport"
  | "setShowCameraUpload"
>;

export function WorldsMenu({
  onExportCurrentWorldSceneLayer,
  onImportSceneLayerFromUrl,
  onImportWorkspaceChangeSet,
  onExportCurrentWorldScenePackage,
  onImportWorldScenePackage,
  onValidateCurrentWorldScenePackage,
  onPublishCurrentWorldScenePackage,
  onListWorldScenePackages,
  onExportWorldRolloutCampaign,
  onRunLocalWorldRollout,
  onImportWorldRolloutResults,
  onOpenWorldRolloutReview,
  exportCamerasAsJSON,
  hasCamerasToExport,
  setShowCameraUpload,
}: WorldsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn(menuTriggerClass, "ml-1")} title="Scene package and layout tools">
          Scene
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("w-56", menuContentClass)}>
        <DropdownMenuItem onClick={onValidateCurrentWorldScenePackage} className={menuItemClass}>
          Validate Scene Package
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportCurrentWorldScenePackage} className={menuItemClass}>
          Export Scene Package
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportWorldScenePackage} className={menuItemClass}>
          Import Scene Package
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPublishCurrentWorldScenePackage} className={menuItemClass}>
          Publish Scene Package
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onListWorldScenePackages} className={menuItemClass}>
          Browse Scene Packages
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportCurrentWorldSceneLayer} className={menuItemClass}>
          Export Layout JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportSceneLayerFromUrl} className={menuItemClass}>
          Import Layout JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportWorkspaceChangeSet} className={menuItemClass}>
          Import Workspace Changes
        </DropdownMenuItem>
        {onExportWorldRolloutCampaign ? (
          <DropdownMenuItem onClick={onExportWorldRolloutCampaign} className={menuItemClass}>
            Export Rollout Campaign
          </DropdownMenuItem>
        ) : null}
        {onRunLocalWorldRollout ? (
          <DropdownMenuItem onClick={onRunLocalWorldRollout} className={menuItemClass}>
            Run Local Rollout
          </DropdownMenuItem>
        ) : null}
        {onImportWorldRolloutResults ? (
          <DropdownMenuItem onClick={onImportWorldRolloutResults} className={menuItemClass}>
            Import Rollout Results
          </DropdownMenuItem>
        ) : null}
        {onOpenWorldRolloutReview ? (
          <DropdownMenuItem onClick={onOpenWorldRolloutReview} className={menuItemClass}>
            Open Rollout Review
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={exportCamerasAsJSON}
          disabled={!hasCamerasToExport}
          className={cn(menuItemClass, !hasCamerasToExport && "opacity-50 cursor-not-allowed")}
        >
          Export Camera Setup
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShowCameraUpload(true)} className={menuItemClass}>
          Import Camera Setup
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
