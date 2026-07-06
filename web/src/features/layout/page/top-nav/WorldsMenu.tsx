import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import type { TopNavBarProps } from "./types";
import { menuContentClass, menuItemClass, menuTriggerClass } from "./menuStyles";

type WorldsMenuProps = Pick<
  TopNavBarProps,
  | "onExportCurrentWorldSceneLayer"
  | "onImportSceneLayerFromUrl"
  | "onImportSplatBackground"
  | "onImportWorkspaceChangeSet"
  | "onValidateCurrentWorldScenePackage"
  | "onPublishCurrentWorldScenePackage"
  | "onListWorldScenePackages"
  | "onExportWorldRolloutCampaign"
  | "onRunLocalWorldRollout"
  | "onImportWorldRolloutResults"
  | "onOpenWorldRolloutReview"
  | "exportCamerasAsJSON"
  | "hasCamerasToExport"
  | "onOpenCameraUpload"
>;

export function WorldsMenu({
  onExportCurrentWorldSceneLayer,
  onImportSceneLayerFromUrl,
  onImportSplatBackground,
  onImportWorkspaceChangeSet,
  onValidateCurrentWorldScenePackage,
  onPublishCurrentWorldScenePackage,
  onListWorldScenePackages,
  onExportWorldRolloutCampaign,
  onRunLocalWorldRollout,
  onImportWorldRolloutResults,
  onOpenWorldRolloutReview,
  exportCamerasAsJSON,
  hasCamerasToExport,
  onOpenCameraUpload,
}: WorldsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn(menuTriggerClass, "ml-1")} title="World document and registry tools">
          Scene
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("w-56", menuContentClass)}>
        <DropdownMenuItem onClick={onValidateCurrentWorldScenePackage} className={menuItemClass}>
          Validate World Package
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPublishCurrentWorldScenePackage} className={menuItemClass}>
          Publish World Package
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onListWorldScenePackages} className={menuItemClass}>
          Browse Published Worlds
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportCurrentWorldSceneLayer} className={menuItemClass}>
          Export World JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportSceneLayerFromUrl} className={menuItemClass}>
          Import World JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportSplatBackground} className={menuItemClass}>
          Import Splat Background
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
        <DropdownMenuItem onClick={onOpenCameraUpload} className={menuItemClass}>
          Import Camera Setup
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
