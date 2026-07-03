import { WORLD_OBJECT_SOURCE_LABELS, WORLD_OBJECT_SOURCES } from "@/shared/types/worldObject";

export const JOINT_LIST_SIDEBAR_PARAMS = {
  leftSidebar: {
    defaultWidth: 220,
    minWidth: 200,
    maxWidth: 320,
  },
  rightSidebar: {
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 450,
  },
  resizeDoubleClick: {
    maxIntervalMs: 320,
    maxDeltaPx: 8,
  },
  worldPanel: {
    minHeight: 72,
    defaultHeight: 132,
    maxHeight: 360,
  },
  hierarchyTree: {
    indentPx: 8,
    lineOffsetPx: 4,
    branchWidthPx: 4,
    linkColor: "#4a9eff",
  },
  panelLayout: {
    structureRows: "minmax(0, 1.35fr) minmax(200px, 0.75fr)",
  },
  minLinkBatchSelectionForEditor: 2,
  classNames: {
    sidebarSection:
      "flex flex-col min-h-0 overflow-hidden rounded-md border border-border/30 bg-background/95 shadow-sm",
    sidebarSectionHeader:
      "flex-shrink-0 border-b border-border/25 bg-muted/10 px-2 py-1.5",
    batchToggleBase:
      "shrink-0 rounded-[2px] border transition-colors inline-flex items-center justify-center",
    batchToggleSelected:
      "border-muted-foreground/55 bg-muted/35 text-foreground",
    batchToggleUnselected:
      "border-border/60 bg-transparent text-transparent hover:border-muted-foreground/55",
    linkTickSize: "h-3.5 w-3.5",
    linkSectionHeader:
      "flex items-center justify-between gap-2 px-1 text-[11px] font-medium text-muted-foreground/80",
    linkCollapseButton:
      "inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground/75 hover:bg-muted/30 hover:text-foreground",
    linkActionChip:
      "inline-flex h-4 items-center rounded border px-1 text-[9px] font-medium leading-none border-border/45 bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/20",
    linkStatusChip:
      "inline-flex h-4 items-center rounded border px-1 text-[9px] font-semibold leading-none",
    linkBrowserText: "text-[11px]",
    structureDropTargetBase:
      "rounded-sm border border-dashed border-transparent",
    structureDropTargetIdle: "border-muted-foreground/20 bg-muted/[0.06]",
    structureDropTargetActive: "border-muted-foreground/45 bg-muted/20",
    structureSubgroupActionButton:
      "inline-flex h-5 items-center gap-1 rounded-sm border border-border/40 bg-muted/10 px-1.5 text-[9px] text-muted-foreground hover:text-foreground hover:bg-muted/20 disabled:opacity-50 disabled:cursor-not-allowed",
    cameraSectionLabel:
      "pt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/75",
    cameraFieldLabel: "text-[8px] leading-none text-muted-foreground/70",
    cameraEditorCompactSelectTrigger: "h-5 text-[10px] bg-muted/15 border-border/40",
    cameraEditorCompactSelectContent: "bg-popover border-border",
    cameraEditorCompactInput: "w-full min-w-[48px] text-[10px]",
    objectEditorCompactSelectTrigger:
      "h-5 text-[9px] bg-[#2a2a2a] border-[#3d3d3d] text-[#d4d4d4]",
    objectEditorCompactSelectContent: "bg-[#2a2a2a] border-[#3d3d3d]",
    objectEditorCompactNumericInput: "w-full min-w-0 text-[10px]",
    objectEditorInlineNumericInput: "w-full min-w-[56px] text-[10px]",
  },
  worldObjectSourceOrder: WORLD_OBJECT_SOURCES,
  worldObjectSourceLabels: WORLD_OBJECT_SOURCE_LABELS,
} as const;

export const DEFAULT_SIDEBAR_WIDTH: number =
  JOINT_LIST_SIDEBAR_PARAMS.leftSidebar.defaultWidth;
export const SIDEBAR_MIN_WIDTH: number =
  JOINT_LIST_SIDEBAR_PARAMS.leftSidebar.minWidth;
export const SIDEBAR_MAX_WIDTH: number =
  JOINT_LIST_SIDEBAR_PARAMS.leftSidebar.maxWidth;
export const DEFAULT_RIGHT_SIDEBAR_WIDTH: number =
  JOINT_LIST_SIDEBAR_PARAMS.rightSidebar.defaultWidth;
export const RIGHT_SIDEBAR_MIN_WIDTH: number =
  JOINT_LIST_SIDEBAR_PARAMS.rightSidebar.minWidth;
export const RIGHT_SIDEBAR_MAX_WIDTH: number =
  JOINT_LIST_SIDEBAR_PARAMS.rightSidebar.maxWidth;
