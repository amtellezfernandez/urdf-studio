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
} from "@/features/layout/structureGroupAssignments";
import { resolveStructureDropGroupLabelFromPoint } from "@/features/layout/structureDragDrop";
import {
  canDropInStructureGroup,
  parseStructureDragPayload,
  resolveStructureDragAutoScrollDelta,
  shouldIgnoreStructureDragStart,
  STRUCTURE_DRAG_DATA_KEY,
  STRUCTURE_SUBGROUP_SUPPORTED_VIEWS,
  type StructureDragState,
  type StructureGroupViewMode,
} from "@/features/layout/structureGroupEditorHelpers";

export type StructureGroupDragHandlers = {
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
  const handleStructureDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>, dragState: StructureDragState) => {
      const targetElement = event.target instanceof HTMLElement ? event.target : null;
      if (
        shouldIgnoreStructureDragStart({
          canReassignStructureGroups,
          dragState,
          targetElement,
        })
      ) {
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
      if (
        !canDropInStructureGroup({
          canReassignStructureGroups,
          dragState,
          targetGroupLabel,
        })
      ) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setActiveStructureDropGroup(targetGroupLabel);
      if (!activeStructureDrag && dragState) {
        setActiveStructureDrag(dragState);
      }
    },
    [activeStructureDrag, canReassignStructureGroups, resolveDragStateFromEvent]
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
      if (
        !canDropInStructureGroup({
          canReassignStructureGroups,
          dragState,
          targetGroupLabel,
        })
      ) {
        return;
      }
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
      canReassignStructureGroups,
      onUrdfChange,
      urdfContent,
    ]
  );
  const handleStructureGroupDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, targetGroupLabel: string) => {
      const dragState = resolveDragStateFromEvent(event);
      if (
        !canDropInStructureGroup({
          canReassignStructureGroups,
          dragState,
          targetGroupLabel,
        }) ||
        !dragState
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      moveDraggedStructureItemToGroup(dragState, targetGroupLabel);
      clearStructureDragState();
    },
    [
      canReassignStructureGroups,
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
      const scrollDelta = resolveStructureDragAutoScrollDelta({
        clientY: event.clientY,
        containerTop: rect.top,
        containerBottom: rect.bottom,
      });

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
