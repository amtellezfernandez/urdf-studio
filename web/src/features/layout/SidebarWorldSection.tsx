import type React from "react";
import { useCallback, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { URDFRobot } from "urdf-loader";
import { JOINT_LIST_SIDEBAR_PARAMS } from "@/features/layout/jointListSidebarParams";
import { WorldPanel } from "@/features/layout/WorldPanel";

const WORLD_PANEL_MIN_HEIGHT: number = JOINT_LIST_SIDEBAR_PARAMS.worldPanel.minHeight;
const WORLD_PANEL_DEFAULT_HEIGHT: number = JOINT_LIST_SIDEBAR_PARAMS.worldPanel.defaultHeight;
const WORLD_PANEL_MAX_HEIGHT: number = JOINT_LIST_SIDEBAR_PARAMS.worldPanel.maxHeight;

type SidebarWorldSectionProps = {
  cameraCount: number;
  endEffectorLink?: string | null;
  objectCount: number;
  onJointSelect?: (jointName: string | null) => void;
  robot?: URDFRobot | null;
  setSelectedLink: (linkName: string | null) => void;
};

export const SidebarWorldSection = ({
  cameraCount,
  endEffectorLink,
  objectCount,
  onJointSelect,
  robot,
  setSelectedLink,
}: SidebarWorldSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [panelHeight, setPanelHeight] = useState(WORLD_PANEL_DEFAULT_HEIGHT);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const totalWorldItems = objectCount + cameraCount;

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isExpanded) return;
      event.preventDefault();
      event.stopPropagation();

      resizeRef.current = {
        startHeight: panelHeight,
        startY: event.clientY,
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const session = resizeRef.current;
        if (!session) return;
        const deltaY = moveEvent.clientY - session.startY;
        const nextHeight = Math.max(
          WORLD_PANEL_MIN_HEIGHT,
          Math.min(WORLD_PANEL_MAX_HEIGHT, session.startHeight + deltaY)
        );
        setPanelHeight(nextHeight);
      };

      const handlePointerUp = () => {
        resizeRef.current = null;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [isExpanded, panelHeight]
  );

  return (
    <div className="rounded-sm border border-border/25 bg-background/55 p-1">
      <button
        type="button"
        aria-label={isExpanded ? "Collapse world panel" : "Expand world panel"}
        className="flex w-full items-center justify-between gap-1 text-left"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          World
        </span>
        <span className="text-[9px] text-muted-foreground">
          {objectCount} obj · {cameraCount} cam
        </span>
      </button>
      {isExpanded ? (
        <div className="mt-1">
          <div
            className="overflow-y-auto pr-1 minimal-scrollbar"
            style={{ height: panelHeight }}
          >
            <WorldPanel
              robot={robot}
              endEffectorLink={endEffectorLink}
              onJointSelect={onJointSelect}
              setSelectedLink={setSelectedLink}
            />
          </div>
          <div
            className="mt-1 h-1.5 cursor-row-resize rounded-sm bg-border/35 transition-colors hover:bg-border/60"
            title="Drag to resize world panel"
            onPointerDown={handleResizeStart}
          />
        </div>
      ) : totalWorldItems === 0 ? (
        <div className="mt-0.5 text-[9px] text-muted-foreground/70">No world items.</div>
      ) : null}
    </div>
  );
};
