import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import type { TopNavBarProps } from "./types";
import { menuContentClass, menuItemClass, menuTriggerClass } from "./menuStyles";

type FileUtilsMenusProps = Pick<
  TopNavBarProps,
  | "openExportDialog"
  | "onSave"
  | "onRevert"
  | "canRevert"
  | "onResetRotation"
  | "hasRotationChanges"
  | "onCanonicalOrder"
  | "onPrettyPrint"
  | "onNormalizeAxes"
  | "onFixMeshPaths"
  | "rotationAxis"
  | "setRotationAxis"
  | "onRotateRobot"
>;

type FileUtilsMenuActionProps = {
  showAssemblyExportAction: boolean;
  onExportAssemblyUrdf?: TopNavBarProps["onExportAssemblyUrdf"];
};

export function FileUtilsMenus({
  openExportDialog,
  onSave,
  onRevert,
  canRevert,
  onResetRotation,
  hasRotationChanges,
  onCanonicalOrder,
  onPrettyPrint,
  onNormalizeAxes,
  onFixMeshPaths,
  rotationAxis,
  setRotationAxis,
  onRotateRobot,
  showAssemblyExportAction,
  onExportAssemblyUrdf,
}: FileUtilsMenusProps & FileUtilsMenuActionProps) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={cn(menuTriggerClass, "ml-1")}>File</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={cn("w-56", menuContentClass)}>
          <DropdownMenuItem onClick={openExportDialog} className={menuItemClass}>
            Export
          </DropdownMenuItem>
          {showAssemblyExportAction && onExportAssemblyUrdf ? (
            <DropdownMenuItem onClick={onExportAssemblyUrdf} className={menuItemClass}>
              Export Assembly URDF
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onSave} className={menuItemClass}>
            Save
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onRevert}
            disabled={!canRevert}
            className={cn(menuItemClass, !canRevert && "opacity-50 cursor-not-allowed")}
            title="Reloads the last saved file"
          >
            Revert
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onResetRotation}
            disabled={!hasRotationChanges}
            className={cn(menuItemClass, !hasRotationChanges && "opacity-50 cursor-not-allowed")}
            title="Reloads the original loaded file"
          >
            Reset
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={menuTriggerClass}>Utils</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={cn("w-48", menuContentClass)}>
          <DropdownMenuItem onClick={onCanonicalOrder} className={menuItemClass}>
            Canonical Order
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onPrettyPrint} className={menuItemClass}>
            Pretty Print
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onNormalizeAxes} className={menuItemClass}>
            Normalize Axes
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFixMeshPaths} className={menuItemClass}>
            Fix Mesh Paths
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={menuItemClass}>Rotate</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={cn("w-32", menuContentClass)}>
              <DropdownMenuItem
                onClick={() => {
                  setRotationAxis("x");
                  onRotateRobot("x");
                }}
                className={cn(menuItemClass, rotationAxis === "x" && "bg-[#3d3d3d] text-white")}
              >
                X
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setRotationAxis("y");
                  onRotateRobot("y");
                }}
                className={cn(menuItemClass, rotationAxis === "y" && "bg-[#3d3d3d] text-white")}
              >
                Y
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setRotationAxis("z");
                  onRotateRobot("z");
                }}
                className={cn(menuItemClass, rotationAxis === "z" && "bg-[#3d3d3d] text-white")}
              >
                Z
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
