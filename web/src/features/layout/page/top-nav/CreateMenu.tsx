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

type CreateMenuProps = Pick<TopNavBarProps, "openObjectCreator" | "setShowCameraCreator">;

export function CreateMenu({ openObjectCreator, setShowCameraCreator }: CreateMenuProps) {
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
            <DropdownMenuItem onClick={() => setShowCameraCreator(true)} className={menuItemClass}>
              Add Camera
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
