import type { ReactNode } from "react";
import { Plus, Search, X } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { cn } from "@/shared/lib/utils";
import {
  LINK_SIDEBAR_GROUPING_MODE_OPTIONS,
  type LinkSidebarGroupingMode,
} from "@/features/layout/linkSidebarGrouping";

type StructureViewMode = "links" | "flat" | "hierarchy";

type StructureModeOption = {
  label: string;
  requiresUrdf?: boolean;
  value: StructureViewMode;
};

type SidebarStructureControlsProps = {
  canReassignStructureGroups: boolean;
  effectiveStructureViewMode: StructureViewMode;
  headerClassName: string;
  isSubgroupCreatorOpen: boolean;
  jointTypes: string[];
  leadingContent?: ReactNode;
  linkGroupingMode: LinkSidebarGroupingMode;
  onCloseSubgroupCreator: () => void;
  onCreateCustomSubgroup: () => void;
  onLinkGroupingModeChange: (mode: LinkSidebarGroupingMode) => void;
  onOpenSubgroupCreator: () => void;
  onSearchQueryChange: (query: string) => void;
  onStructureViewModeChange: (mode: StructureViewMode) => void;
  onSubgroupDraftLabelChange: (label: string) => void;
  onTypeFilterChange: (typeFilter: string) => void;
  searchQuery: string;
  structureModeOptions: StructureModeOption[];
  subgroupActionButtonClassName: string;
  subgroupDraftLabel: string;
  typeFilter: string;
  urdfContentAvailable: boolean;
};

export const SidebarStructureControls = ({
  canReassignStructureGroups,
  effectiveStructureViewMode,
  headerClassName,
  isSubgroupCreatorOpen,
  jointTypes,
  leadingContent = null,
  linkGroupingMode,
  onCloseSubgroupCreator,
  onCreateCustomSubgroup,
  onLinkGroupingModeChange,
  onOpenSubgroupCreator,
  onSearchQueryChange,
  onStructureViewModeChange,
  onSubgroupDraftLabelChange,
  onTypeFilterChange,
  searchQuery,
  structureModeOptions,
  subgroupActionButtonClassName,
  subgroupDraftLabel,
  typeFilter,
  urdfContentAvailable,
}: SidebarStructureControlsProps) => {
  const showSubgroupControls =
    effectiveStructureViewMode === "links" || effectiveStructureViewMode === "flat";
  const subgroupDisabled =
    !canReassignStructureGroups ||
    (effectiveStructureViewMode === "links" && linkGroupingMode !== "body");
  const subgroupTitle = !canReassignStructureGroups
    ? "Group editing is unavailable"
    : effectiveStructureViewMode === "links" && linkGroupingMode !== "body"
      ? "Subgroups are only available in Body grouping"
      : "Create an empty subgroup drop target";

  return (
    <>
      <div className={headerClassName}>
        {leadingContent}
        <div className="flex items-center gap-1">
          {structureModeOptions.map((option) => {
            const isActive = effectiveStructureViewMode === option.value;
            const isDisabled = Boolean(option.requiresUrdf && !urdfContentAvailable);
            return (
              <button
                key={option.value}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (isDisabled) {
                    return;
                  }
                  onStructureViewModeChange(option.value);
                }}
                title={option.label}
                className={cn(
                  "h-5 truncate rounded-sm border px-1.5 text-[9px] transition-colors",
                  isActive
                    ? "border-border bg-background text-foreground"
                    : "border-border/30 bg-muted/10 text-muted-foreground hover:text-foreground",
                  isDisabled && "opacity-40 cursor-not-allowed"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-shrink-0 border-b border-border/20 bg-background/90 p-1">
        <div className="flex items-center gap-1">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder={
                effectiveStructureViewMode === "links" ? "Search links..." : "Search joints..."
              }
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              className="h-6 pl-6 pr-6 text-[11px] bg-muted/20 border-border/50"
            />
            {searchQuery ? (
              <button
                type="button"
                aria-label="Clear structure search"
                onClick={() => onSearchQueryChange("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>

          {effectiveStructureViewMode === "flat" ? (
            <Select value={typeFilter} onValueChange={onTypeFilterChange}>
              <SelectTrigger className="h-6 w-24 text-[11px] bg-muted/20 border-border/50">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="all" className="text-xs">
                  All
                </SelectItem>
                {jointTypes.map((type) => (
                  <SelectItem key={type} value={type} className="text-xs capitalize">
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {showSubgroupControls ? (
            <button
              type="button"
              className={subgroupActionButtonClassName}
              onClick={onOpenSubgroupCreator}
              disabled={subgroupDisabled}
              title={subgroupTitle}
            >
              <Plus className="h-3 w-3" />
              <span>Subgroup</span>
            </button>
          ) : null}
        </div>
        {effectiveStructureViewMode === "links" ? (
          <div className="mt-1.5 flex items-center gap-1">
            {LINK_SIDEBAR_GROUPING_MODE_OPTIONS.map((option) => {
              const isActive = linkGroupingMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "h-5 rounded-sm border px-1.5 text-[9px] transition-colors",
                    isActive
                      ? "border-border bg-background text-foreground"
                      : "border-border/30 bg-muted/10 text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => onLinkGroupingModeChange(option.value)}
                  aria-pressed={isActive}
                  aria-label={`Group links by ${option.label}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {showSubgroupControls && isSubgroupCreatorOpen ? (
          <div className="mt-1.5 flex items-center gap-1">
            <Input
              type="text"
              value={subgroupDraftLabel}
              onChange={(event) => onSubgroupDraftLabelChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCreateCustomSubgroup();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCloseSubgroupCreator();
                }
              }}
              placeholder="New subgroup (e.g. arm1_gripper)"
              className="h-6 text-[10px] bg-muted/20 border-border/50"
              autoFocus
            />
            <button
              type="button"
              className="h-6 rounded-sm border border-border/50 px-1.5 text-[10px] text-foreground hover:bg-muted/20"
              onClick={onCreateCustomSubgroup}
            >
              Add
            </button>
            <button
              type="button"
              className="h-6 rounded-sm border border-border/35 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={onCloseSubgroupCreator}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
};
