import type { PointerEvent as ReactPointerEvent } from "react";
import {
  SIDEBAR_RESIZER_TOP_OFFSET,
  SIDEBAR_RESIZER_WIDTH,
} from "@/features/layout/page/constants";

type SidebarResizeHandleProps = {
  side: "left" | "right";
  sidebarWidth: number;
  ariaLabel: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export const SidebarResizeHandle = ({
  side,
  sidebarWidth,
  ariaLabel,
  onPointerDown,
}: SidebarResizeHandleProps) => (
  <div
    role="separator"
    aria-orientation="vertical"
    aria-label={ariaLabel}
    onPointerDown={onPointerDown}
    className="group fixed z-40 cursor-col-resize select-none"
    style={{
      top: SIDEBAR_RESIZER_TOP_OFFSET,
      bottom: 0,
      [side]: sidebarWidth - SIDEBAR_RESIZER_WIDTH / 2,
      width: SIDEBAR_RESIZER_WIDTH,
    }}
  >
    <span className="pointer-events-none absolute top-1/2 left-1/2 h-10 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/65 transition-colors group-hover:bg-primary/45" />
  </div>
);
