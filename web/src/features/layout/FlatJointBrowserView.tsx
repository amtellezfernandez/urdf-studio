import type React from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { JointLimits } from "@/shared/lib/urdfBrowser";
import { cn } from "@/shared/lib/utils";
import { JointListItem } from "@/features/layout/JointListItem";
import { StructureSectionShell } from "@/features/layout/StructureSectionShell";
import {
  toGroupDisplayLabel,
  type StructureGroupSection,
} from "@/features/layout/structureGroups";
import { resolveVisibleSectionItemNames } from "@/features/layout/structureSectionVisibility";
import type { StructureDragState } from "@/features/layout/useStructureGroupEditor";

type FlatJointBrowserViewProps = {
  activeMovingJointNames: Set<string>;
  activeStructureDropGroup: string | null;
  angleUnit: "rad" | "deg";
  availableJoints: string[];
  canReassignStructureGroups: boolean;
  colorJointNames: string[];
  collapsedJointSectionIds: ReadonlySet<string>;
  deletedJoints: Set<string>;
  groupedJointsWithCustom: readonly StructureGroupSection[];
  hoveredJoint?: string | null;
  isStructureDragActive: boolean;
  jointEffortLimits: Record<string, number | undefined>;
  jointLimits: JointLimits;
  onJointHover?: (jointName: string | null) => void;
  onJointSelect: (jointName: string) => void;
  onStructureDragEnd: () => void;
  onStructureDragStart: (
    event: React.DragEvent<HTMLElement>,
    dragState: StructureDragState
  ) => void;
  onStructureGroupDragLeave: (
    event: React.DragEvent<HTMLElement>,
    targetGroupLabel: string
  ) => void;
  onStructureGroupDragOver: (
    event: React.DragEvent<HTMLElement>,
    targetGroupLabel: string
  ) => void;
  onStructureGroupDrop: (
    event: React.DragEvent<HTMLElement>,
    targetGroupLabel: string
  ) => void;
  onToggleJointSectionCollapse: (sectionId: string) => void;
  onVisibilityToggle: (jointName: string) => void;
  searchQuery: string;
  selectedJoint?: string | null;
  structureJointLabels: Record<string, string | undefined>;
  typeFilter: string;
  visibleJoints: Set<string>;
};

export const FlatJointBrowserView = ({
  activeMovingJointNames,
  activeStructureDropGroup,
  angleUnit,
  availableJoints,
  canReassignStructureGroups,
  colorJointNames,
  collapsedJointSectionIds,
  deletedJoints,
  groupedJointsWithCustom,
  hoveredJoint,
  isStructureDragActive,
  jointEffortLimits,
  jointLimits,
  onJointHover,
  onJointSelect,
  onStructureDragEnd,
  onStructureDragStart,
  onStructureGroupDragLeave,
  onStructureGroupDragOver,
  onStructureGroupDrop,
  onToggleJointSectionCollapse,
  onVisibilityToggle,
  searchQuery,
  selectedJoint,
  structureJointLabels,
  typeFilter,
  visibleJoints,
}: FlatJointBrowserViewProps) => {
  if (groupedJointsWithCustom.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
        {searchQuery || typeFilter !== "all" ? "No joints match the filters" : "No joints available"}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {groupedJointsWithCustom.map((section) => {
        const isCollapsed = collapsedJointSectionIds.has(section.id);
        const visibleJointNames = resolveVisibleSectionItemNames({
          sectionItemNames: section.items,
          isSectionCollapsed: isCollapsed,
          activeItemNamesWhenCollapsed: activeMovingJointNames,
        });
        return (
          <StructureSectionShell
            key={section.id}
            sectionLabel={section.label}
            itemCount={section.items.length}
            canReassignStructureGroups={canReassignStructureGroups}
            isStructureDragActive={isStructureDragActive}
            activeStructureDropGroup={activeStructureDropGroup}
            onDragOver={onStructureGroupDragOver}
            onDragLeave={onStructureGroupDragLeave}
            onDrop={onStructureGroupDrop}
            headerClassName="flex items-center justify-between gap-2 px-1 text-[9px] uppercase tracking-[0.06em] text-muted-foreground/75"
            renderHeaderContent={() => (
              <button
                type="button"
                className="flex min-w-0 items-center gap-1 text-left text-muted-foreground/85 hover:text-foreground"
                onClick={() => onToggleJointSectionCollapse(section.id)}
                title={isCollapsed ? "Expand joint section" : "Collapse joint section"}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{toGroupDisplayLabel(section.label)}</span>
              </button>
            )}
          >
            {visibleJointNames.map((jointName) => (
              <div
                key={jointName}
                draggable={canReassignStructureGroups}
                onDragStart={(event) =>
                  onStructureDragStart(event, {
                    sourceType: "joint",
                    sourceName: jointName,
                    sourceGroupLabel: section.label,
                  })
                }
                onDragEnd={onStructureDragEnd}
                className={cn(canReassignStructureGroups && "cursor-grab active:cursor-grabbing")}
              >
                <div className="flex items-center gap-1">
                  {canReassignStructureGroups ? (
                    <span
                      className="inline-flex items-center px-1 text-muted-foreground/50"
                      title="Drag to move joint to another group"
                    >
                      <GripVertical className="h-3 w-3" />
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <JointListItem
                      jointName={jointName}
                      jointInfo={jointLimits[jointName]}
                      effortLimit={jointEffortLimits[jointName] ?? null}
                      onValueChange={() => {}}
                      isDeleted={deletedJoints.has(jointName)}
                      isSelected={selectedJoint === jointName}
                      isHighlighted={hoveredJoint === jointName}
                      angleUnit={angleUnit}
                      onClick={() => onJointSelect(jointName)}
                      onHover={onJointHover}
                      availableJoints={availableJoints}
                      colorJointNames={colorJointNames}
                      isVisible={visibleJoints.has(jointName)}
                      onVisibilityToggle={onVisibilityToggle}
                      groupLabel={structureJointLabels[jointName] ?? section.label ?? null}
                    />
                  </div>
                </div>
              </div>
            ))}
          </StructureSectionShell>
        );
      })}
    </div>
  );
};
