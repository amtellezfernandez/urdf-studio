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

type CreateMenuProps = Pick<TopNavBarProps, "openObjectCreator" | "onOpenCameraCreator">;

export function CreateMenu({ openObjectCreator, onOpenCameraCreator }: CreateMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn(menuTriggerClass, "ml-1")}>Create</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("w-48", menuContentClass)}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={menuItemClass}>Objects</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn("w-32", menuContentClass)}>
            <DropdownMenuItem onClick={() => openObjectCreator("cube")} className={menuItemClass}>
              Cube
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openObjectCreator("point")} className={menuItemClass}>
              Point
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={menuItemClass}>Camera</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn("w-48", menuContentClass)}>
            <DropdownMenuItem onClick={onOpenCameraCreator} className={menuItemClass}>
              Add Camera
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
