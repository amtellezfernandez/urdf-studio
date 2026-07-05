import type { RobotStructureLabels } from "@/features/layout/robotStructureLabels";
import type { StructureMoveSourceType } from "@/features/layout/structureGroupAssignments";
import {
  normalizeStructureGroupLabel,
} from "@/features/layout/structureGroupAssignments";
import {
  STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX,
  STRUCTURE_DRAG_AUTOSCROLL_MAX_STEP_PX,
} from "@/features/layout/structureDragParams";
import { toGroupDisplayLabel } from "@/features/layout/structureGroups";

export type StructureGroupViewMode = "links" | "flat" | "hierarchy";

export type StructureDragState = {
  sourceType: StructureMoveSourceType;
  sourceName: string;
  sourceGroupLabel: string;
};

export const STRUCTURE_SUBGROUP_SUPPORTED_VIEWS = new Set<StructureGroupViewMode>([
  "links",
  "flat",
]);

export const STRUCTURE_DRAG_MIME_TYPES = {
  dataKey: "application/x-urdf-studio-structure-drag",
} as const;

export const parseStructureDragPayload = (
  payloadRaw: string
): StructureDragState | null => {
  if (!payloadRaw) {
    return null;
  }

  try {
    const parsed = JSON.parse(payloadRaw) as Partial<StructureDragState>;
    if (!parsed || (parsed.sourceType !== "joint" && parsed.sourceType !== "link")) {
      return null;
    }
    if (
      typeof parsed.sourceName !== "string" ||
      parsed.sourceName.length === 0 ||
      typeof parsed.sourceGroupLabel !== "string" ||
      parsed.sourceGroupLabel.length === 0
    ) {
      return null;
    }

    return {
      sourceType: parsed.sourceType,
      sourceName: parsed.sourceName,
      sourceGroupLabel: parsed.sourceGroupLabel,
    };
  } catch {
    return null;
  }
};

export const canDropInStructureGroup = ({
  canReassignStructureGroups,
  dragState,
  targetGroupLabel,
}: {
  canReassignStructureGroups: boolean;
  dragState: StructureDragState | null;
  targetGroupLabel: string;
}): boolean => {
  if (!canReassignStructureGroups || !dragState) {
    return false;
  }
  return Boolean(targetGroupLabel);
};

export const resolveStructureDragAutoScrollDelta = ({
  clientY,
  containerTop,
  containerBottom,
}: {
  clientY: number;
  containerTop: number;
  containerBottom: number;
}): number => {
  const pointerDistanceToTop = clientY - containerTop;
  const pointerDistanceToBottom = containerBottom - clientY;

  if (
    pointerDistanceToTop >= 0 &&
    pointerDistanceToTop < STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX
  ) {
    const ratio =
      (STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX - pointerDistanceToTop) /
      STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX;
    return -STRUCTURE_DRAG_AUTOSCROLL_MAX_STEP_PX * ratio;
  }

  if (
    pointerDistanceToBottom >= 0 &&
    pointerDistanceToBottom < STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX
  ) {
    const ratio =
      (STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX - pointerDistanceToBottom) /
      STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX;
    return STRUCTURE_DRAG_AUTOSCROLL_MAX_STEP_PX * ratio;
  }

  return 0;
};

export const shouldIgnoreStructureDragStart = ({
  canReassignStructureGroups,
  dragState,
  targetElement,
}: {
  canReassignStructureGroups: boolean;
  dragState: StructureDragState;
  targetElement: HTMLElement | null;
}): boolean => {
  if (!canReassignStructureGroups) {
    return true;
  }
  return dragState.sourceType === "link" && Boolean(targetElement?.closest("button"));
};

export const resolveKnownStructureGroupLabelSet = ({
  customStructureGroupLabels,
  structureLabels,
}: {
  customStructureGroupLabels: readonly string[];
  structureLabels: RobotStructureLabels;
}): Set<string> => {
  const labels = new Set<string>(customStructureGroupLabels);
  Object.values(structureLabels.linkByName).forEach((label) => {
    const normalized = normalizeStructureGroupLabel(label ?? "");
    if (normalized) {
      labels.add(normalized);
    }
  });
  Object.values(structureLabels.jointByName).forEach((label) => {
    const normalized = normalizeStructureGroupLabel(label ?? "");
    if (normalized) {
      labels.add(normalized);
    }
  });
  return labels;
};

export const resolveCreateSubgroupOutcome = ({
  canReassignStructureGroups,
  knownStructureGroupLabelSet,
  subgroupDraftLabel,
}: {
  canReassignStructureGroups: boolean;
  knownStructureGroupLabelSet: ReadonlySet<string>;
  subgroupDraftLabel: string;
}):
  | { kind: "error"; message: string }
  | { kind: "info"; message: string }
  | { kind: "success"; message: string; normalizedLabel: string } => {
  if (!canReassignStructureGroups) {
    return {
      kind: "error",
      message: "Group editing is unavailable for this URDF.",
    };
  }

  const normalizedLabel = normalizeStructureGroupLabel(subgroupDraftLabel);
  if (!normalizedLabel) {
    return {
      kind: "error",
      message: "Subgroup name cannot be empty.",
    };
  }

  if (knownStructureGroupLabelSet.has(normalizedLabel)) {
    return {
      kind: "info",
      message: `${toGroupDisplayLabel(normalizedLabel)} already exists.`,
    };
  }

  return {
    kind: "success",
    message: `Added subgroup ${toGroupDisplayLabel(normalizedLabel)}.`,
    normalizedLabel,
  };
};

export const shouldCloseSubgroupCreatorForView = ({
  isSubgroupCreatorOpen,
  viewMode,
}: {
  isSubgroupCreatorOpen: boolean;
  viewMode: StructureGroupViewMode;
}): boolean =>
  isSubgroupCreatorOpen && !STRUCTURE_SUBGROUP_SUPPORTED_VIEWS.has(viewMode);

export const shouldClearStructureDragState = ({
  activeStructureDrag,
  activeStructureDropGroup,
  canReassignStructureGroups,
}: {
  activeStructureDrag: StructureDragState | null;
  activeStructureDropGroup: string | null;
  canReassignStructureGroups: boolean;
}): boolean =>
  !canReassignStructureGroups &&
  (activeStructureDrag !== null || activeStructureDropGroup !== null);

export const shouldCloseSubgroupCreatorWhenUnavailable = ({
  canReassignStructureGroups,
  isSubgroupCreatorOpen,
  subgroupDraftLabel,
}: {
  canReassignStructureGroups: boolean;
  isSubgroupCreatorOpen: boolean;
  subgroupDraftLabel: string;
}): boolean =>
  !canReassignStructureGroups &&
  (isSubgroupCreatorOpen || subgroupDraftLabel.length > 0);
