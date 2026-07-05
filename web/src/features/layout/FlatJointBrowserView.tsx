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
import type { StructureGroupDragHandlers } from "@/features/layout/useStructureGroupEditor";
import {
  resolveFlatJointBrowserEmptyState,
  resolveJointGroupLabel,
} from "@/features/layout/flatJointBrowserViewHelpers";

type FlatJointBrowserViewProps = StructureGroupDragHandlers & {
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
        {resolveFlatJointBrowserEmptyState({ searchQuery, typeFilter })}
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
            {visibleJointNames.map((jointName) => {
              const jointListItemProps = {
                angleUnit,
                availableJoints,
                colorJointNames,
                effortLimit: jointEffortLimits[jointName] ?? null,
                isDeleted: deletedJoints.has(jointName),
                isHighlighted: hoveredJoint === jointName,
                isSelected: selectedJoint === jointName,
                isVisible: visibleJoints.has(jointName),
                jointInfo: jointLimits[jointName],
                jointName,
                onClick: () => onJointSelect(jointName),
                onHover: onJointHover,
                onValueChange: () => {},
                onVisibilityToggle,
              } as const;

              return (
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
                        {...jointListItemProps}
                        groupLabel={resolveJointGroupLabel({
                          fallbackSectionLabel: section.label,
                          jointName,
                          structureJointLabels,
                        })}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </StructureSectionShell>
        );
      })}
    </div>
  );
};
