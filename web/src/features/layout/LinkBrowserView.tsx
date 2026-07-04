import type React from "react";
import { Check, ChevronRight, GripVertical } from "lucide-react";
import type { LinkData } from "@/shared/lib/urdfBrowser";
import { cn } from "@/shared/lib/utils";
import { JOINT_LIST_SIDEBAR_PARAMS } from "@/features/layout/jointListSidebarParams";
import { StructureSectionShell } from "@/features/layout/StructureSectionShell";
import type { StructureGroupSection } from "@/features/layout/structureGroups";
import type { StructureGroupDragHandlers } from "@/features/layout/useStructureGroupEditor";
import {
  canAddMeshCollisionForLink,
  isEntireLinkSectionBatchSelected,
  resolveLinkBrowserEmptyState,
  resolveVisibleLinkNames,
} from "@/features/layout/linkBrowserViewHelpers";
import { resolveLinkBrowserRowState } from "@/features/layout/linkBrowserRowState";

type LinkBrowserViewProps = StructureGroupDragHandlers & {
  activeStructureDropGroup: string | null;
  areAllFilteredLinksSelected: boolean;
  canReassignDisplayedLinkGroups: boolean;
  collapsedLinkSectionIds: ReadonlySet<string>;
  displayedLinkSections: readonly StructureGroupSection[];
  effectiveEndEffectorLink: string | null;
  endEffectorLink?: string | null;
  formatSectionLabel: (sectionLabel: string) => string;
  highlightedLinkName: string | null;
  isStructureDragActive: boolean;
  linkDataByName: Record<string, LinkData> | null;
  linksWithCollisionSet: ReadonlySet<string>;
  mergedLinkSet: ReadonlySet<string>;
  onAddMeshCollisionForLink: (linkName: string) => void;
  onBatchLinkToggle: (linkName: string) => void;
  onLinkSelect: (linkName: string) => void;
  onMarkAsEndEffector?: (linkName: string | null) => void;
  onToggleBatchLinkGroup: (linkNames: string[]) => void;
  onToggleLinkSectionCollapse: (sectionId: string) => void;
  onToggleSelectAllFilteredLinks: () => void;
  searchQuery: string;
  selectedBatchLinkNames: readonly string[];
  selectedBatchLinks: ReadonlySet<string>;
  selectedLink: string | null;
  simplifiedLinkSet: ReadonlySet<string>;
  voxelDerivedInertialLinkSet: ReadonlySet<string>;
};

const JOINT_LIST_CLASS_NAMES = JOINT_LIST_SIDEBAR_PARAMS.classNames;
const BATCH_TOGGLE_BASE_CLASS = JOINT_LIST_CLASS_NAMES.batchToggleBase;
const BATCH_TOGGLE_SELECTED_CLASS = JOINT_LIST_CLASS_NAMES.batchToggleSelected;
const BATCH_TOGGLE_UNSELECTED_CLASS = JOINT_LIST_CLASS_NAMES.batchToggleUnselected;
const LINK_TICK_SIZE_CLASS = JOINT_LIST_CLASS_NAMES.linkTickSize;
const LINK_SECTION_HEADER_CLASS = JOINT_LIST_CLASS_NAMES.linkSectionHeader;
const LINK_COLLAPSE_BUTTON_CLASS = JOINT_LIST_CLASS_NAMES.linkCollapseButton;
const LINK_ACTION_CHIP_CLASS = JOINT_LIST_CLASS_NAMES.linkActionChip;
const LINK_STATUS_CHIP_CLASS = JOINT_LIST_CLASS_NAMES.linkStatusChip;
const LINK_BROWSER_TEXT_CLASS = JOINT_LIST_CLASS_NAMES.linkBrowserText;

const BatchSelectionTick = ({
  selected,
  squareClassName,
}: {
  selected: boolean;
  squareClassName: string;
}) => (
  <span
    className={cn(
      BATCH_TOGGLE_BASE_CLASS,
      squareClassName,
      selected ? BATCH_TOGGLE_SELECTED_CLASS : BATCH_TOGGLE_UNSELECTED_CLASS
    )}
  >
    <Check className="h-2.5 w-2.5" />
  </span>
);

export const LinkBrowserView = ({
  activeStructureDropGroup,
  areAllFilteredLinksSelected,
  canReassignDisplayedLinkGroups,
  collapsedLinkSectionIds,
  displayedLinkSections,
  effectiveEndEffectorLink,
  endEffectorLink,
  formatSectionLabel,
  highlightedLinkName,
  isStructureDragActive,
  linkDataByName,
  linksWithCollisionSet,
  mergedLinkSet,
  onAddMeshCollisionForLink,
  onBatchLinkToggle,
  onLinkSelect,
  onMarkAsEndEffector,
  onStructureDragEnd,
  onStructureDragStart,
  onStructureGroupDragLeave,
  onStructureGroupDragOver,
  onStructureGroupDrop,
  onToggleBatchLinkGroup,
  onToggleLinkSectionCollapse,
  onToggleSelectAllFilteredLinks,
  searchQuery,
  selectedBatchLinkNames,
  selectedBatchLinks,
  selectedLink,
  simplifiedLinkSet,
  voxelDerivedInertialLinkSet,
}: LinkBrowserViewProps) => {
  if (displayedLinkSections.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
        {resolveLinkBrowserEmptyState(searchQuery)}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between rounded-sm border border-border/30 bg-muted/10 px-2 py-1">
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 text-muted-foreground hover:text-foreground",
            LINK_BROWSER_TEXT_CLASS
          )}
          onClick={onToggleSelectAllFilteredLinks}
        >
          <BatchSelectionTick
            selected={areAllFilteredLinksSelected}
            squareClassName={LINK_TICK_SIZE_CLASS}
          />
          <span>{areAllFilteredLinksSelected ? "Remove selection" : "Select all"}</span>
        </button>
        <span className={cn("text-muted-foreground tabular-nums", LINK_BROWSER_TEXT_CLASS)}>
          {selectedBatchLinkNames.length} selected
        </span>
      </div>
      {displayedLinkSections.map((section) => {
        const isCollapsed = collapsedLinkSectionIds.has(section.id);
        const sectionDisplayLabel = formatSectionLabel(section.label);
        const visibleLinkNames = resolveVisibleLinkNames({
          effectiveEndEffectorLink,
          isCollapsed,
          sectionItemNames: section.items,
        });
        return (
          <StructureSectionShell
            key={section.id}
            sectionLabel={section.label}
            itemCount={section.items.length}
            canReassignStructureGroups={canReassignDisplayedLinkGroups}
            isStructureDragActive={isStructureDragActive}
            activeStructureDropGroup={activeStructureDropGroup}
            onDragOver={onStructureGroupDragOver}
            onDragLeave={onStructureGroupDragLeave}
            onDrop={onStructureGroupDrop}
            headerClassName={LINK_SECTION_HEADER_CLASS}
            renderHeaderContent={() => (
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  className={LINK_COLLAPSE_BUTTON_CLASS}
                  onClick={() => onToggleLinkSectionCollapse(section.id)}
                  title={
                    isCollapsed
                      ? `Show ${sectionDisplayLabel} links`
                      : `Hide ${sectionDisplayLabel} links`
                  }
                  aria-label={
                    isCollapsed
                      ? `Show ${sectionDisplayLabel} links`
                      : `Hide ${sectionDisplayLabel} links`
                  }
                >
                  <ChevronRight
                    className={cn("h-3 w-3 transition-transform", !isCollapsed && "rotate-90")}
                  />
                </button>
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1.5 text-left text-muted-foreground/85 hover:text-foreground"
                  onClick={() => onToggleBatchLinkGroup(section.items)}
                  title={`Select all links in ${sectionDisplayLabel}`}
                >
                  <BatchSelectionTick
                    selected={isEntireLinkSectionBatchSelected({
                      sectionItemNames: section.items,
                      selectedBatchLinks,
                    })}
                    squareClassName={LINK_TICK_SIZE_CLASS}
                  />
                  <span className="truncate">{sectionDisplayLabel}</span>
                </button>
              </div>
            )}
          >
            {visibleLinkNames.map((linkName) => {
              const isBatchSelected = selectedBatchLinks.has(linkName);
              const isLinkSelected = selectedLink === linkName;
              const isLinkHighlighted = highlightedLinkName === linkName;
              const linkData = linkDataByName?.[linkName] ?? null;
              const {
                canAddMeshCollision,
                hasUrdfCollision,
                hasVoxelDerivedInertial,
                statusSummary,
              } = resolveLinkBrowserRowState({
                effectiveEndEffectorLink,
                linkData,
                linkName,
                linksWithCollisionSet,
                mergedLinkSet,
                simplifiedLinkSet,
                voxelDerivedInertialLinkSet,
              });

              return (
                <div
                  key={linkName}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors cursor-pointer",
                    isLinkSelected
                      ? "border-sky-500/45 bg-sky-500/12"
                      : isLinkHighlighted
                        ? "border-sky-500/30 bg-sky-500/8"
                        : "border-transparent hover:border-border/40 hover:bg-muted/20",
                    canReassignDisplayedLinkGroups && "cursor-grab active:cursor-grabbing"
                  )}
                  draggable={canReassignDisplayedLinkGroups}
                  onDragStart={(event) =>
                    onStructureDragStart(event, {
                      sourceType: "link",
                      sourceName: linkName,
                      sourceGroupLabel: section.label,
                    })
                  }
                  onDragEnd={onStructureDragEnd}
                  onClick={() => onLinkSelect(linkName)}
                >
                  {canReassignDisplayedLinkGroups ? (
                    <span
                      className="inline-flex items-center text-muted-foreground/50"
                      title="Drag to move link to another group"
                    >
                      <GripVertical className="h-3 w-3" />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex"
                    onClick={(event) => {
                      event.stopPropagation();
                      onBatchLinkToggle(linkName);
                      onLinkSelect(linkName);
                    }}
                    title={
                      isBatchSelected
                        ? "Remove from link batch selection"
                        : "Add to link batch selection"
                    }
                  >
                    <BatchSelectionTick
                      selected={isBatchSelected}
                      squareClassName={LINK_TICK_SIZE_CLASS}
                    />
                  </button>
                  <span
                    className={cn(
                      "font-medium min-w-0 flex-1 truncate text-foreground/90",
                      LINK_BROWSER_TEXT_CLASS
                    )}
                    title={linkName}
                  >
                    {linkName}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {hasUrdfCollision ? (
                      <span
                        className={cn(
                          LINK_STATUS_CHIP_CLASS,
                          "border-slate-400/40 bg-slate-400/15 text-slate-200"
                        )}
                        title="Link has URDF collision definitions"
                      >
                        Col
                      </span>
                    ) : canAddMeshCollision ? (
                      <button
                        type="button"
                        className={LINK_ACTION_CHIP_CLASS}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAddMeshCollisionForLink(linkName);
                        }}
                        title="Add mesh collision from visual geometry (manual)"
                      >
                        Add Col
                      </button>
                    ) : null}
                    {statusSummary.label ? (
                      <span
                        className={cn(
                          LINK_STATUS_CHIP_CLASS,
                          "border-cyan-500/40 bg-cyan-500/15 text-cyan-200"
                        )}
                        title={statusSummary.title}
                      >
                        {statusSummary.label}
                      </span>
                    ) : null}
                    {hasVoxelDerivedInertial ? (
                      <span
                        className={cn(
                          LINK_STATUS_CHIP_CLASS,
                          "border-cyan-400/40 bg-cyan-400/12 text-cyan-100"
                        )}
                        title="The staged inertial draft for this link used volumetric voxel fallback."
                      >
                        Vox
                      </span>
                    ) : null}
                    {onMarkAsEndEffector ? (
                      <button
                        type="button"
                        className={cn(
                          LINK_ACTION_CHIP_CLASS,
                          effectiveEndEffectorLink === linkName
                            ? "border-primary/60 bg-primary/20 text-primary"
                            : ""
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMarkAsEndEffector(endEffectorLink === linkName ? null : linkName);
                        }}
                        title={endEffectorLink === linkName ? "Clear end-effector" : "Mark as end-effector"}
                      >
                        {endEffectorLink === linkName ? "Clear EE" : "Set EE"}
                      </button>
                    ) : null}
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
