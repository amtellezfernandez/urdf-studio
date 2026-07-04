import type { StructureMoveSourceType } from "@/features/layout/structureGroupAssignments";
import {
  STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX,
  STRUCTURE_DRAG_AUTOSCROLL_MAX_STEP_PX,
} from "@/features/layout/structureDragParams";

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

export const STRUCTURE_DRAG_DATA_KEY = "application/x-urdf-studio-structure-drag";

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
