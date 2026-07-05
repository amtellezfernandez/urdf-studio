import type { MouseEvent } from "react";

import { cn } from "@/shared/lib/utils";
import {
  getDragModeDisplayName,
  type DragMode,
} from "@/features/viewer/viewer-helpers";
import { getStudioWheelRoleLabel } from "@/features/viewer/studioWheelDriveHeuristics";
import type { StudioWheelRoleDisplayEntry } from "@/features/viewer/studioWheelDriveModel";

type WorldObjectEditMode = "move" | "rotate" | "resize";

type ViewerTopToolsProps = {
  activeWheelDriveCount: number;
  canUseDragHandleMode: boolean;
  dragMode: DragMode;
  hasSelectedWorldObject: boolean;
  hasStudioWheelDrive: boolean;
  isFollowingOrbit: boolean;
  isObjectToolsOpen: boolean;
  isReadOnly: boolean;
  isRobotLoaded: boolean;
  isWheelDriveEnabled: boolean;
  isWheelRolesOpen: boolean;
  objectEditMode: WorldObjectEditMode;
  orbitFollowProgress: number;
  studioWheelRoleDisplayEntries: readonly StudioWheelRoleDisplayEntry[];
  onDeleteSelectedWorldObject: () => void;
  onDuplicateSelectedWorldObject: () => void;
  onObjectEditModeSelect: (mode: WorldObjectEditMode) => void;
  onObjectToolsToggle: () => void;
  onResetPose: () => void;
  onStopOrbitFollow: () => void;
  onToggleWheelDriveMode: () => void;
  onToggleWheelRoles: () => void;
  onWheelDriveJointToggle: (jointName: string) => void;
  onDragModeSelect: (mode: DragMode) => void;
};

const VIEWER_TOP_TOOL_CLASSES = {
  toolbar:
    "absolute left-48 top-4 right-24 z-20 flex min-w-0 flex-nowrap items-center justify-end gap-2 overflow-visible [&>*]:shrink-0",
  button: "rounded border border-border/60 bg-background/90 shadow-sm transition-colors",
  disabledButton: "text-muted-foreground opacity-70 cursor-not-allowed",
} as const;

const WORLD_OBJECT_EDIT_MODE_LABELS: Record<WorldObjectEditMode, string> = {
  move: "Move",
  rotate: "Rotate",
  resize: "Transform",
};

const WORLD_OBJECT_EDIT_MODES: readonly WorldObjectEditMode[] = [
  "move",
  "rotate",
  "resize",
];
const DRAG_MODE_OPTIONS: readonly DragMode[] = ["move-joints", "drag-handle"];

const WORLD_OBJECT_EDIT_MODE_TITLES: Record<WorldObjectEditMode, string> = {
  move: "Move (G)",
  rotate: "Rotate (R)",
  resize: "Transform (S)",
};

const stopPropagation = (event: MouseEvent) => {
  event.stopPropagation();
};

export function ViewerTopTools({
  activeWheelDriveCount,
  canUseDragHandleMode,
  dragMode,
  hasSelectedWorldObject,
  hasStudioWheelDrive,
  isFollowingOrbit,
  isObjectToolsOpen,
  isReadOnly,
  isRobotLoaded,
  isWheelDriveEnabled,
  isWheelRolesOpen,
  objectEditMode,
  orbitFollowProgress,
  studioWheelRoleDisplayEntries,
  onDeleteSelectedWorldObject,
  onDuplicateSelectedWorldObject,
  onObjectEditModeSelect,
  onObjectToolsToggle,
  onResetPose,
  onStopOrbitFollow,
  onToggleWheelDriveMode,
  onToggleWheelRoles,
  onWheelDriveJointToggle,
  onDragModeSelect,
}: ViewerTopToolsProps) {
  const hasWheelRoleEntries = studioWheelRoleDisplayEntries.length > 0;
  const visibleDragModeOptions = canUseDragHandleMode
    ? DRAG_MODE_OPTIONS
    : DRAG_MODE_OPTIONS.filter((mode) => mode === "move-joints");

  return (
    <div className={VIEWER_TOP_TOOL_CLASSES.toolbar}>
      {!isReadOnly ? (
        <div
          className={cn(
            "flex items-center gap-1 px-1 py-0.5 text-xs",
            VIEWER_TOP_TOOL_CLASSES.button,
            isRobotLoaded ? "text-foreground" : VIEWER_TOP_TOOL_CLASSES.disabledButton
          )}
          onClick={stopPropagation}
        >
          <span className="px-1 text-[10px] text-muted-foreground">Drag</span>
          {visibleDragModeOptions.map((mode) => (
            <button
              key={mode}
              type="button"
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                dragMode === mode
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              disabled={!isRobotLoaded}
              onClick={() => onDragModeSelect(mode)}
            >
              {getDragModeDisplayName(mode)}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className={cn(
          "px-3 py-1 text-xs",
          VIEWER_TOP_TOOL_CLASSES.button,
          isRobotLoaded
            ? "text-foreground hover:bg-muted"
            : VIEWER_TOP_TOOL_CLASSES.disabledButton
        )}
        disabled={!isRobotLoaded}
        onClick={(event) => {
          stopPropagation(event);
          onResetPose();
        }}
      >
        Reset Pose
      </button>

      {!isReadOnly ? (
        <div className="relative" onClick={stopPropagation}>
          <button
            type="button"
            className={cn(
              "px-2 py-1 text-[11px]",
              VIEWER_TOP_TOOL_CLASSES.button,
              hasSelectedWorldObject
                ? "text-foreground hover:bg-muted"
                : VIEWER_TOP_TOOL_CLASSES.disabledButton
            )}
            disabled={!hasSelectedWorldObject}
            onClick={onObjectToolsToggle}
            aria-expanded={isObjectToolsOpen}
            title="Selected object tools"
          >
            <span className="inline-flex items-center gap-1.5">
              <span>
                {hasSelectedWorldObject
                  ? WORLD_OBJECT_EDIT_MODE_LABELS[objectEditMode]
                  : "Object"}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {hasSelectedWorldObject ? (isObjectToolsOpen ? "▲" : "▼") : ""}
              </span>
            </span>
          </button>
          {hasSelectedWorldObject && isObjectToolsOpen ? (
            <div className="absolute right-0 z-30 mt-1 w-48 rounded border border-border/70 bg-background/95 p-1 shadow-md">
              <div className="grid grid-cols-2 gap-1">
                {WORLD_OBJECT_EDIT_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onObjectEditModeSelect(mode)}
                    className={cn(
                      "rounded border border-border/60 bg-background/85 px-2 py-1 text-left text-[9px] leading-none transition-colors hover:bg-muted",
                      objectEditMode === mode && "bg-muted text-foreground"
                    )}
                    title={WORLD_OBJECT_EDIT_MODE_TITLES[mode]}
                  >
                    {WORLD_OBJECT_EDIT_MODE_LABELS[mode]}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onDuplicateSelectedWorldObject}
                  className="rounded border border-border/60 bg-background/85 px-2 py-1 text-left text-[9px] leading-none transition-colors hover:bg-muted"
                  title="Duplicate selected (Shift+D)"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={onDeleteSelectedWorldObject}
                  className="rounded border border-border/60 bg-background/85 px-2 py-1 text-left text-[9px] leading-none transition-colors hover:bg-muted"
                  title="Delete selected (Delete)"
                >
                  Delete
                </button>
              </div>
              <div className="mt-1 px-0.5 text-[8px] leading-none text-muted-foreground/80">
                G move • R rotate • S transform • Shift+D duplicate • Del delete
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isReadOnly && hasStudioWheelDrive && hasWheelRoleEntries ? (
        <div className="relative" onClick={stopPropagation}>
          <button
            type="button"
            className={cn(
              "px-2 py-1 text-[11px] text-foreground hover:bg-muted",
              VIEWER_TOP_TOOL_CLASSES.button
            )}
            onClick={onToggleWheelRoles}
            aria-expanded={isWheelRolesOpen}
            title="Wheel drive mode and per-wheel role toggles."
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isWheelDriveEnabled ? "bg-emerald-500" : "bg-muted-foreground/45"
                )}
              />
              <span>
                Wheels {activeWheelDriveCount}/{studioWheelRoleDisplayEntries.length}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {isWheelRolesOpen ? "▲" : "▼"}
              </span>
            </span>
          </button>
          {isWheelRolesOpen ? (
            <div className="absolute right-0 z-30 mt-1 w-48 rounded border border-border/70 bg-background/95 p-1 shadow-md">
              <div className="mb-1 flex items-center gap-1">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded border border-border/60 bg-background/85 px-2 py-1 text-[9px] text-foreground transition-colors hover:bg-muted"
                  onClick={onToggleWheelDriveMode}
                  title={
                    isWheelDriveEnabled ? "Set wheels to brake" : "Enable wheel drive"
                  }
                >
                  <span className="inline-flex items-center gap-1.5 uppercase tracking-[0.08em] text-muted-foreground">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        isWheelDriveEnabled
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/45"
                      )}
                    />
                    Motion
                  </span>
                  <span className="font-mono text-[8px] uppercase text-muted-foreground">
                    {isWheelDriveEnabled ? "On" : "Brake"}
                  </span>
                </button>
              </div>
              <div className="grid gap-1">
                {studioWheelRoleDisplayEntries.map((entry) => (
                  <button
                    key={entry.jointName}
                    type="button"
                    onClick={() => onWheelDriveJointToggle(entry.jointName)}
                    aria-pressed={entry.driveEnabled}
                    title={`${entry.jointName} • ${entry.driveEnabled ? "On" : "Off"}`}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded border border-border/60 bg-background/85 px-1.5 py-1 text-[9px] text-foreground transition-colors hover:bg-muted",
                      !entry.driveEnabled && "text-muted-foreground"
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/70 bg-background/85 px-1 font-mono text-[8px] font-semibold leading-none text-foreground">
                        {entry.wheelNumber}
                      </span>
                      <span className="text-[8px] uppercase tracking-[0.08em]">
                        {entry.side}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          entry.driveEnabled && isWheelDriveEnabled
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/45"
                        )}
                      />
                      <span className="text-[8px] uppercase tracking-[0.08em] text-muted-foreground/80">
                        {getStudioWheelRoleLabel(entry.role)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isReadOnly && isFollowingOrbit ? (
        <button
          type="button"
          className="flex items-center gap-1 rounded border border-orange-500/60 bg-orange-500/10 px-3 py-1 text-xs text-orange-600 shadow-sm transition-colors hover:bg-orange-500/20"
          onClick={(event) => {
            stopPropagation(event);
            onStopOrbitFollow();
          }}
        >
          Stop Orbit ({orbitFollowProgress.toFixed(0)}%)
        </button>
      ) : null}
    </div>
  );
}
