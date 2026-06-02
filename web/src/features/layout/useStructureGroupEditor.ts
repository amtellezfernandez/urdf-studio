import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import type { RobotStructureLabels } from "@/features/layout/robotStructureLabels";
import {
  buildStructureGroupSections,
  mergeStructureGroupSections,
  toGroupDisplayLabel,
  type StructureGroupSection,
} from "@/features/layout/structureGroups";
import {
  moveStructureItemToGroup,
  normalizeStructureGroupLabel,
  type StructureMoveSourceType,
} from "@/features/layout/structureGroupAssignments";
import {
  STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX,
  STRUCTURE_DRAG_AUTOSCROLL_MAX_STEP_PX,
} from "@/features/layout/structureDragParams";
import { resolveStructureDropGroupLabelFromPoint } from "@/features/layout/structureDragDrop";

export type StructureGroupViewMode = "links" | "flat" | "hierarchy";

export type StructureDragState = {
  sourceType: StructureMoveSourceType;
  sourceName: string;
  sourceGroupLabel: string;
};

type UseStructureGroupEditorArgs = {
  analysis: UrdfAnalysis | null;
  urdfContent: string | undefined;
  onUrdfChange?: ((newContent: string) => void) | undefined;
  structureLabels: RobotStructureLabels;
  viewMode: StructureGroupViewMode;
  filteredLinks: string[];
  filteredJoints: string[];
};

type UseStructureGroupEditorResult = {
  canReassignStructureGroups: boolean;
  isStructureDragActive: boolean;
  groupedLinksWithCustom: StructureGroupSection[];
  groupedJointsWithCustom: StructureGroupSection[];
  activeStructureDropGroup: string | null;
  isSubgroupCreatorOpen: boolean;
  subgroupDraftLabel: string;
  setSubgroupDraftLabel: (value: string) => void;
  openSubgroupCreator: () => void;
  closeSubgroupCreator: () => void;
  createCustomSubgroup: () => void;
  handleStructureDragStart: (event: React.DragEvent<HTMLElement>, dragState: StructureDragState) => void;
  handleStructureGroupDragOver: (
    event: React.DragEvent<HTMLElement>,
    targetGroupLabel: string
  ) => void;
  handleStructureGroupDragLeave: (
    event: React.DragEvent<HTMLElement>,
    targetGroupLabel: string
  ) => void;
  handleStructureGroupDrop: (event: React.DragEvent<HTMLElement>, targetGroupLabel: string) => void;
  handleStructureListDragOver: (
    event: React.DragEvent<HTMLElement>,
    scrollContainer: HTMLDivElement | null
  ) => void;
  handleStructureListDrop: (
    event: React.DragEvent<HTMLElement>,
    scrollContainer: HTMLDivElement | null
  ) => void;
  handleStructureDragEnd: () => void;
};

const STRUCTURE_SUBGROUP_SUPPORTED_VIEWS = new Set<StructureGroupViewMode>(["links", "flat"]);
const STRUCTURE_DRAG_DATA_KEY = "application/x-urdf-studio-structure-drag";

const parseStructureDragPayload = (payloadRaw: string): StructureDragState | null => {
  if (!payloadRaw) return null;
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

export const useStructureGroupEditor = ({
  analysis,
  urdfContent,
  onUrdfChange,
  structureLabels,
  viewMode,
  filteredLinks,
  filteredJoints,
}: UseStructureGroupEditorArgs): UseStructureGroupEditorResult => {
  const canReassignStructureGroups = Boolean(onUrdfChange && urdfContent && analysis?.isValid);
  const [activeStructureDrag, setActiveStructureDrag] = useState<StructureDragState | null>(null);
  const activeStructureDragRef = useRef<StructureDragState | null>(null);
  const [isStructureDragActive, setIsStructureDragActive] = useState(false);
  const [activeStructureDropGroup, setActiveStructureDropGroup] = useState<string | null>(null);
  const [customStructureGroupLabels, setCustomStructureGroupLabels] = useState<string[]>([]);
  const [isSubgroupCreatorOpen, setIsSubgroupCreatorOpen] = useState(false);
  const [subgroupDraftLabel, setSubgroupDraftLabelState] = useState("");

  const knownStructureGroupLabelSet = useMemo(() => {
    const labels = new Set<string>(customStructureGroupLabels);
    Object.values(structureLabels.linkByName).forEach((label) => {
      const normalized = normalizeStructureGroupLabel(label ?? "");
      if (normalized) labels.add(normalized);
    });
    Object.values(structureLabels.jointByName).forEach((label) => {
      const normalized = normalizeStructureGroupLabel(label ?? "");
      if (normalized) labels.add(normalized);
    });
    return labels;
  }, [customStructureGroupLabels, structureLabels.jointByName, structureLabels.linkByName]);

  const groupedLinks = useMemo(
    () => buildStructureGroupSections(filteredLinks, structureLabels.linkByName),
    [filteredLinks, structureLabels.linkByName]
  );
  const groupedJoints = useMemo(
    () => buildStructureGroupSections(filteredJoints, structureLabels.jointByName),
    [filteredJoints, structureLabels.jointByName]
  );
  const groupedLinksWithCustom = useMemo(
    () => mergeStructureGroupSections(groupedLinks, customStructureGroupLabels),
    [customStructureGroupLabels, groupedLinks]
  );
  const groupedJointsWithCustom = useMemo(
    () => mergeStructureGroupSections(groupedJoints, customStructureGroupLabels),
    [customStructureGroupLabels, groupedJoints]
  );

  const setSubgroupDraftLabel = useCallback((value: string) => {
    setSubgroupDraftLabelState(value);
  }, []);
  const closeSubgroupCreator = useCallback(() => {
    setIsSubgroupCreatorOpen(false);
    setSubgroupDraftLabelState("");
  }, []);
  const openSubgroupCreator = useCallback(() => {
    if (!canReassignStructureGroups) return;
    setIsSubgroupCreatorOpen(true);
  }, [canReassignStructureGroups]);
  const createCustomSubgroup = useCallback(() => {
    if (!canReassignStructureGroups) {
      toast.error("Group editing is unavailable for this URDF.");
      return;
    }
    const normalizedLabel = normalizeStructureGroupLabel(subgroupDraftLabel);
    if (!normalizedLabel) {
      toast.error("Subgroup name cannot be empty.");
      return;
    }
    if (knownStructureGroupLabelSet.has(normalizedLabel)) {
      toast.info(`${toGroupDisplayLabel(normalizedLabel)} already exists.`);
      return;
    }
    setCustomStructureGroupLabels((prev) => [...prev, normalizedLabel]);
    closeSubgroupCreator();
    toast.success(`Added subgroup ${toGroupDisplayLabel(normalizedLabel)}.`);
  }, [
    canReassignStructureGroups,
    closeSubgroupCreator,
    knownStructureGroupLabelSet,
    subgroupDraftLabel,
  ]);

  const clearStructureDragState = useCallback(() => {
    activeStructureDragRef.current = null;
    setIsStructureDragActive(false);
    setActiveStructureDrag(null);
    setActiveStructureDropGroup(null);
  }, []);
  const resolveDragStateFromEvent = useCallback(
    (event: React.DragEvent<HTMLElement>): StructureDragState | null => {
      if (activeStructureDragRef.current) return activeStructureDragRef.current;
      if (activeStructureDrag) return activeStructureDrag;
      const payloadRaw = event.dataTransfer.getData(STRUCTURE_DRAG_DATA_KEY);
      return parseStructureDragPayload(payloadRaw);
    },
    [activeStructureDrag]
  );
  const canDropInStructureGroup = useCallback(
    (dragState: StructureDragState | null, targetGroupLabel: string) => {
      if (!canReassignStructureGroups || !dragState) return false;
      return Boolean(targetGroupLabel);
    },
    [canReassignStructureGroups]
  );

  const handleStructureDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>, dragState: StructureDragState) => {
      if (!canReassignStructureGroups) {
        event.preventDefault();
        return;
      }
      const targetElement = event.target instanceof HTMLElement ? event.target : null;
      if (dragState.sourceType === "link" && targetElement?.closest("button")) {
        event.preventDefault();
        return;
      }

      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(STRUCTURE_DRAG_DATA_KEY, JSON.stringify(dragState));
      event.dataTransfer.setData("text/plain", `${dragState.sourceType}:${dragState.sourceName}`);
      activeStructureDragRef.current = dragState;
      setIsStructureDragActive(true);
      setActiveStructureDrag(dragState);
      setActiveStructureDropGroup(null);
    },
    [canReassignStructureGroups]
  );
  const handleStructureGroupDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>, targetGroupLabel: string) => {
      const dragState = resolveDragStateFromEvent(event);
      if (!canDropInStructureGroup(dragState, targetGroupLabel)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setActiveStructureDropGroup(targetGroupLabel);
      if (!activeStructureDrag && dragState) {
        setActiveStructureDrag(dragState);
      }
    },
    [activeStructureDrag, canDropInStructureGroup, resolveDragStateFromEvent]
  );
  const handleStructureGroupDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>, targetGroupLabel: string) => {
      if (activeStructureDropGroup !== targetGroupLabel) return;
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
        return;
      }
      setActiveStructureDropGroup((current) => (current === targetGroupLabel ? null : current));
    },
    [activeStructureDropGroup]
  );
  const moveDraggedStructureItemToGroup = useCallback(
    (dragState: StructureDragState, targetGroupLabel: string) => {
      if (!canDropInStructureGroup(dragState, targetGroupLabel)) return;
      if (!urdfContent || !onUrdfChange) return;
      if (dragState.sourceGroupLabel === targetGroupLabel) {
        return;
      }

      const nextUrdfContent = moveStructureItemToGroup({
        urdfContent,
        sourceType: dragState.sourceType,
        sourceName: dragState.sourceName,
        targetGroupLabel,
        analysis,
      });
      if (nextUrdfContent === urdfContent) {
        toast.info("No group change was applied.");
        return;
      }

      onUrdfChange(nextUrdfContent);
      toast.success(
        `Moved ${dragState.sourceType} "${dragState.sourceName}" to ${toGroupDisplayLabel(targetGroupLabel)}.`
      );
    },
    [
      analysis,
      canDropInStructureGroup,
      onUrdfChange,
      urdfContent,
    ]
  );
  const handleStructureGroupDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, targetGroupLabel: string) => {
      const dragState = resolveDragStateFromEvent(event);
      if (!canDropInStructureGroup(dragState, targetGroupLabel) || !dragState) return;
      event.preventDefault();
      event.stopPropagation();
      moveDraggedStructureItemToGroup(dragState, targetGroupLabel);
      clearStructureDragState();
    },
    [
      canDropInStructureGroup,
      clearStructureDragState,
      moveDraggedStructureItemToGroup,
      resolveDragStateFromEvent,
    ]
  );
  const resolveDropGroupFromPointer = useCallback(
    (event: React.DragEvent<HTMLElement>, scrollContainer: HTMLDivElement): string | null =>
      resolveStructureDropGroupLabelFromPoint({
        container: scrollContainer,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    []
  );
  const handleStructureListDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>, scrollContainer: HTMLDivElement | null) => {
      const dragState = resolveDragStateFromEvent(event);
      if (!dragState || !canReassignStructureGroups || !scrollContainer) {
        return;
      }
      event.preventDefault();
      const hoveredDropGroupLabel = resolveDropGroupFromPointer(event, scrollContainer);
      setActiveStructureDropGroup(hoveredDropGroupLabel);
      event.dataTransfer.dropEffect = hoveredDropGroupLabel ? "move" : "none";

      const rect = scrollContainer.getBoundingClientRect();
      const pointerDistanceToTop = event.clientY - rect.top;
      const pointerDistanceToBottom = rect.bottom - event.clientY;
      let scrollDelta = 0;

      if (
        pointerDistanceToTop >= 0 &&
        pointerDistanceToTop < STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX
      ) {
        const ratio =
          (STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX - pointerDistanceToTop) /
          STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX;
        scrollDelta = -STRUCTURE_DRAG_AUTOSCROLL_MAX_STEP_PX * ratio;
      } else if (
        pointerDistanceToBottom >= 0 &&
        pointerDistanceToBottom < STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX
      ) {
        const ratio =
          (STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX - pointerDistanceToBottom) /
          STRUCTURE_DRAG_AUTOSCROLL_EDGE_PX;
        scrollDelta = STRUCTURE_DRAG_AUTOSCROLL_MAX_STEP_PX * ratio;
      }

      if (scrollDelta !== 0) {
        scrollContainer.scrollTop += scrollDelta;
      }
    },
    [canReassignStructureGroups, resolveDragStateFromEvent, resolveDropGroupFromPointer]
  );
  const handleStructureListDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, scrollContainer: HTMLDivElement | null) => {
      const dragState = resolveDragStateFromEvent(event);
      if (!canReassignStructureGroups || !dragState || !scrollContainer) {
        return;
      }
      const dropGroupLabel =
        resolveDropGroupFromPointer(event, scrollContainer) ?? activeStructureDropGroup;
      event.preventDefault();
      if (!dropGroupLabel) {
        clearStructureDragState();
        return;
      }
      moveDraggedStructureItemToGroup(dragState, dropGroupLabel);
      clearStructureDragState();
    },
    [
      activeStructureDropGroup,
      canReassignStructureGroups,
      clearStructureDragState,
      moveDraggedStructureItemToGroup,
      resolveDragStateFromEvent,
      resolveDropGroupFromPointer,
    ]
  );
  const handleStructureDragEnd = useCallback(() => {
    clearStructureDragState();
  }, [clearStructureDragState]);

  useEffect(() => {
    if (STRUCTURE_SUBGROUP_SUPPORTED_VIEWS.has(viewMode)) return;
    if (!isSubgroupCreatorOpen) return;
    closeSubgroupCreator();
  }, [closeSubgroupCreator, isSubgroupCreatorOpen, viewMode]);
  useEffect(() => {
    if (canReassignStructureGroups) return;
    if (!activeStructureDrag && !activeStructureDropGroup) return;
    clearStructureDragState();
  }, [
    activeStructureDrag,
    activeStructureDropGroup,
    canReassignStructureGroups,
    clearStructureDragState,
  ]);
  useEffect(() => {
    if (canReassignStructureGroups) return;
    if (!isSubgroupCreatorOpen && subgroupDraftLabel.length === 0) return;
    closeSubgroupCreator();
  }, [
    canReassignStructureGroups,
    closeSubgroupCreator,
    isSubgroupCreatorOpen,
    subgroupDraftLabel.length,
  ]);

  return {
    canReassignStructureGroups,
    isStructureDragActive,
    groupedLinksWithCustom,
    groupedJointsWithCustom,
    activeStructureDropGroup,
    isSubgroupCreatorOpen,
    subgroupDraftLabel,
    setSubgroupDraftLabel,
    openSubgroupCreator,
    closeSubgroupCreator,
    createCustomSubgroup,
    handleStructureDragStart,
    handleStructureGroupDragOver,
    handleStructureGroupDragLeave,
    handleStructureGroupDrop,
    handleStructureListDragOver,
    handleStructureListDrop,
    handleStructureDragEnd,
  };
};
