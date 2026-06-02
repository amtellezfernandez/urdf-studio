import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import type { TopNavBarProps } from "./types";
import { menuContentClass, menuItemClass, menuTriggerClass } from "./menuStyles";

type IkMenuProps = Pick<
  TopNavBarProps,
  "isIkPanelOpen" | "onOpenIkPanel" | "selectedIkSolverId" | "ikSolverOptions" | "onSelectIkSolver"
>;

export function IkMenu({
  isIkPanelOpen,
  onOpenIkPanel,
  selectedIkSolverId,
  ikSolverOptions,
  onSelectIkSolver,
}: IkMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="IK options"
          onClick={onOpenIkPanel}
          className={cn(
            menuTriggerClass,
            "ml-1",
            isIkPanelOpen ? "bg-[#3d3d3d] text-white" : "text-[#d4d4d4] hover:text-white hover:bg-[#3d3d3d]"
          )}
        >
          IK
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("w-56", menuContentClass)}>
        <DropdownMenuItem
          disabled
          className="text-[10px] uppercase tracking-[0.12em] text-[#9f9f9f] opacity-90"
        >
          Solver
        </DropdownMenuItem>
        {ikSolverOptions.map((solver) => (
          <DropdownMenuItem
            key={solver.id}
            onClick={() => onSelectIkSolver(solver.id)}
            className={cn(
              menuItemClass,
              "flex items-center justify-between",
              selectedIkSolverId === solver.id && "bg-[#3d3d3d] text-white"
            )}
          >
            <span>{solver.label}</span>
            {selectedIkSolverId === solver.id ? <Check className="h-3 w-3" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
