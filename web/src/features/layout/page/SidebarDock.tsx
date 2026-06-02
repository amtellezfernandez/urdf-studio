import type { ComponentType, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { SidebarResizeHandle } from "@/features/layout/page/SidebarResizeHandle";

type SidebarDockProps = {
  side: "left" | "right";
  sidebarWidth: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  collapseButtonLabel?: string;
  CollapseIcon: ComponentType<{ className?: string }>;
  children: ReactNode;
};

const COLLAPSE_BUTTON_POSITION_CLASS = {
  left: "left-4",
  right: "right-4",
} as const;

export const SidebarDock = ({
  side,
  sidebarWidth,
  isCollapsed,
  onToggleCollapse,
  onResizeStart,
  collapseButtonLabel = "Panel",
  CollapseIcon,
  children,
}: SidebarDockProps) => (
  <>
    {children}

    {!isCollapsed ? (
      <SidebarResizeHandle
        side={side}
        sidebarWidth={sidebarWidth}
        ariaLabel={side === "left" ? "Resize sidebar" : "Resize right sidebar"}
        onPointerDown={onResizeStart}
      />
    ) : (
      <button
        type="button"
        onClick={onToggleCollapse}
        className={`fixed bottom-6 ${COLLAPSE_BUTTON_POSITION_CLASS[side]} z-40 flex items-center gap-1 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm shadow-sm transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
      >
        <CollapseIcon className="h-3 w-3" />
        {collapseButtonLabel}
      </button>
    )}
  </>
);
