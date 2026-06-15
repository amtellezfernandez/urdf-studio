import type { ComponentType, MouseEventHandler } from "react";
import { X } from "lucide-react";
import { Button } from "@/shared/ui/button";

type HealthActionPanelHeaderProps = {
  isDragging: boolean;
  onClose?: () => void;
  onDragStart: MouseEventHandler<HTMLDivElement>;
  panelLabel?: string;
  statusIcon: ComponentType<{ className?: string }>;
  title: string;
};

export const HealthActionPanelHeader = ({
  isDragging,
  onClose,
  onDragStart,
  panelLabel = "Open In",
  statusIcon: StatusIcon,
  title,
}: HealthActionPanelHeaderProps) => (
  <div
    data-drag-handle="simulation-prep"
    className={`flex items-start gap-3 border-b border-border/60 p-3 select-none ${
      isDragging ? "cursor-grabbing" : "cursor-grab"
    }`}
    onMouseDown={onDragStart}
    title={`Drag ${panelLabel} panel`}
  >
    <StatusIcon className="mt-0.5 h-4 w-4 text-foreground" />
    <div className="min-w-0 flex-1 pr-2">
      <div className="text-sm font-semibold text-foreground">{title}</div>
    </div>
    <div className="-mr-1 -mt-1 flex shrink-0 items-center self-start">
      {onClose ? (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onClose}
          aria-label={`Close ${panelLabel} panel`}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  </div>
);
