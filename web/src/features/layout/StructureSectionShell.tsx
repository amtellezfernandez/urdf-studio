import type React from "react";

import { JOINT_LIST_SIDEBAR_PARAMS } from "@/features/layout/jointListSidebarParams";
import { STRUCTURE_DROP_GROUP_LABEL_ATTRIBUTE } from "@/features/layout/structureDragDrop";
import { cn } from "@/shared/lib/utils";

type StructureSectionShellProps = {
  sectionLabel: string;
  itemCount: number;
  canReassignStructureGroups: boolean;
  isStructureDragActive: boolean;
  activeStructureDropGroup: string | null;
  onDragOver: (event: React.DragEvent<HTMLElement>, sectionLabel: string) => void;
  onDragLeave: (event: React.DragEvent<HTMLElement>, sectionLabel: string) => void;
  onDrop: (event: React.DragEvent<HTMLElement>, sectionLabel: string) => void;
  headerClassName: string;
  renderHeaderContent: () => React.ReactNode;
  children: React.ReactNode;
};

const STRUCTURE_DROP_TARGET_BASE_CLASS =
  JOINT_LIST_SIDEBAR_PARAMS.classNames.structureDropTargetBase;
const STRUCTURE_DROP_TARGET_IDLE_CLASS =
  JOINT_LIST_SIDEBAR_PARAMS.classNames.structureDropTargetIdle;
const STRUCTURE_DROP_TARGET_ACTIVE_CLASS =
  JOINT_LIST_SIDEBAR_PARAMS.classNames.structureDropTargetActive;

export const StructureSectionShell = ({
  sectionLabel,
  itemCount,
  canReassignStructureGroups,
  isStructureDragActive,
  activeStructureDropGroup,
  onDragOver,
  onDragLeave,
  onDrop,
  headerClassName,
  renderHeaderContent,
  children,
}: StructureSectionShellProps) => (
  <section
    className={cn(
      "space-y-0.5 rounded-sm",
      canReassignStructureGroups &&
        isStructureDragActive &&
        activeStructureDropGroup !== sectionLabel &&
        STRUCTURE_DROP_TARGET_BASE_CLASS,
      canReassignStructureGroups &&
        isStructureDragActive &&
        activeStructureDropGroup !== sectionLabel &&
        STRUCTURE_DROP_TARGET_IDLE_CLASS
    )}
    {...{ [STRUCTURE_DROP_GROUP_LABEL_ATTRIBUTE]: sectionLabel }}
    onDragOver={(event) => onDragOver(event, sectionLabel)}
    onDragLeave={(event) => onDragLeave(event, sectionLabel)}
    onDrop={(event) => onDrop(event, sectionLabel)}
  >
    <div
      className={cn(
        headerClassName,
        canReassignStructureGroups && STRUCTURE_DROP_TARGET_BASE_CLASS,
        activeStructureDropGroup === sectionLabel && STRUCTURE_DROP_TARGET_ACTIVE_CLASS
      )}
    >
      {renderHeaderContent()}
      <span className="tabular-nums">{itemCount}</span>
    </div>
    {children}
  </section>
);
