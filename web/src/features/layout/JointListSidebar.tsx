import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { JointControl } from "@/features/layout/JointControl";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import {
  Camera as CameraIcon,
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  type JointAxisMap,
  type JointLimits,
  type LinkData,
} from "@/shared/lib/urdfBrowser";
import type { UrdfAnalysis } from "@/shared/lib/urdfCore";
import { useObjectStore } from "@/features/objects";
import { useCameraStore } from "@/shared/store/useCameraStore";
import { useJointStore } from "@/shared/store/useJointStore";
import { useLinkHighlightStore } from "@/shared/store/useLinkHighlightStore";
import { analyzeUrdf } from "@/shared/lib/urdfCore";
import { getJointColor } from "@/features/urdf/utils/jointColors";
import { addCollisionToLink } from "@/features/urdf/editor/updateLinkData";
import type { URDFRobot } from "urdf-loader";
import { LinkControl } from "@/features/urdf/editor/LinkEditor";
import type { CollisionVisibility } from "@/features/urdf/editor/LinkEditor";
import {
  buildFilteredHierarchyJoints,
  buildFilteredJointNames,
  buildHierarchyTree,
  buildJointTypes,
} from "@/features/layout/sidebarSelectors";
import {
  filterLinksForSidebar,
  resolveLinkSidebarInteractionState,
  type LinkSidebarViewMode,
} from "@/features/layout/linkSidebarFilters";
import { buildRobotStructureLabels } from "@/features/layout/robotStructureLabels";
import {
  expandStructureSectionsContainingItem,
  toGroupDisplayLabel,
} from "@/features/layout/structureGroups";
import {
  buildAlphabeticalLinkSections,
  buildMeshGroupedLinkSections,
  LINK_SIDEBAR_GROUPING_MODE_OPTIONS,
  type LinkSidebarGroupingMode,
} from "@/features/layout/linkSidebarGrouping";
import { JointListItem } from "@/features/layout/JointListItem";
import {
  TOP_NAV_HEIGHT,
  VIEWPORT_HEIGHT_WITH_TOP_NAV,
} from "@/features/layout/page/constants";
import { applyCollisionSimplifyToSelectedLinks } from "@/features/viewer/collisionSimplifySelection";
import {
  removeMergedCollisionLinks,
  replaceMergedCollisionLinks,
} from "@/features/viewer/collisionMergeSelection";
import { useStructureGroupEditor } from "@/features/layout/useStructureGroupEditor";
import {
  areStringSetsEqual,
  reconcileCollapsedSectionIds,
  resolveVisibleSectionItemNames,
} from "@/features/layout/structureSectionVisibility";
import { resolveEffectiveEndEffectorLink } from "@/features/layout/endEffectorSelection";
import {
  advanceJointActivityState,
  createInitialJointActivityState,
  resolveActiveJointNameSet,
} from "@/features/layout/jointActivity";
import { JOINT_ACTIVITY_PARAMS } from "@/features/layout/jointActivityParams";
import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  JOINT_LIST_SIDEBAR_PARAMS,
} from "@/features/layout/jointListSidebarParams";
import { parseJointEffortLimits } from "@/features/layout/jointEffortLimits";
import { StructureSectionShell } from "@/features/layout/StructureSectionShell";
import { HierarchyTreeView } from "@/features/layout/HierarchyTreeView";
import { WorldPanel } from "@/features/layout/WorldPanel";
import { CameraEditorPanel } from "@/features/layout/CameraEditorPanel";
import { ObjectEditorPanel } from "@/features/layout/ObjectEditorPanel";
import { LinkBatchEditorPanel } from "@/features/layout/LinkBatchEditorPanel";
import type { InertialDensityPresetId } from "@/features/urdf/inertia/inertialSynthesisParams";

const toggleStringSetValue = (previous: Set<string>, value: string) => {
  const next = new Set(previous);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
};


const JOINT_LIST_CLASS_NAMES = JOINT_LIST_SIDEBAR_PARAMS.classNames;

const WORLD_PANEL_MIN_HEIGHT: number = JOINT_LIST_SIDEBAR_PARAMS.worldPanel.minHeight;
const WORLD_PANEL_DEFAULT_HEIGHT: number = JOINT_LIST_SIDEBAR_PARAMS.worldPanel.defaultHeight;
const WORLD_PANEL_MAX_HEIGHT: number = JOINT_LIST_SIDEBAR_PARAMS.worldPanel.maxHeight;
const SIDEBAR_PANEL_LAYOUT = JOINT_LIST_SIDEBAR_PARAMS.panelLayout;
const SIDEBAR_SECTION_CLASS = JOINT_LIST_CLASS_NAMES.sidebarSection;
const SIDEBAR_SECTION_HEADER_CLASS = JOINT_LIST_CLASS_NAMES.sidebarSectionHeader;
const MIN_LINK_BATCH_SELECTION_FOR_EDITOR = JOINT_LIST_SIDEBAR_PARAMS.minLinkBatchSelectionForEditor;
const BATCH_TOGGLE_BASE_CLASS = JOINT_LIST_CLASS_NAMES.batchToggleBase;
const BATCH_TOGGLE_SELECTED_CLASS = JOINT_LIST_CLASS_NAMES.batchToggleSelected;
const BATCH_TOGGLE_UNSELECTED_CLASS = JOINT_LIST_CLASS_NAMES.batchToggleUnselected;
const LINK_TICK_SIZE_CLASS = JOINT_LIST_CLASS_NAMES.linkTickSize;
const LINK_SECTION_HEADER_CLASS = JOINT_LIST_CLASS_NAMES.linkSectionHeader;
const LINK_COLLAPSE_BUTTON_CLASS = JOINT_LIST_CLASS_NAMES.linkCollapseButton;
const LINK_ACTION_CHIP_CLASS = JOINT_LIST_CLASS_NAMES.linkActionChip;
const LINK_STATUS_CHIP_CLASS = JOINT_LIST_CLASS_NAMES.linkStatusChip;
const LINK_BROWSER_TEXT_CLASS = JOINT_LIST_CLASS_NAMES.linkBrowserText;
const STRUCTURE_SUBGROUP_ACTION_BUTTON_CLASS = JOINT_LIST_CLASS_NAMES.structureSubgroupActionButton;
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

interface JointListSidebarProps {
  availableJoints: string[];
  availableLinks?: string[];
  jointLimits: JointLimits;
  selectedJoint?: string | null;
  selectedLink?: string | null;
  hoveredLink?: string | null;
  onJointSelect?: (jointName: string | null) => void;
  onLinkSelect?: (linkName: string | null) => void;
  onJointHover?: (jointName: string | null) => void;
  hoveredJoint?: string | null;
  deletedJoints?: Set<string>;
  width?: number;
  isCollapsed?: boolean;
  angleUnit?: "rad" | "deg";
  onAngleUnitChange?: (unit: "rad" | "deg") => void;
  urdfContent?: string;
  urdfAnalysis?: UrdfAnalysis | null;
  jointAxes?: JointAxisMap;
  originalJointAxes?: JointAxisMap;
  onJointChange?: (jointName: string, value: number) => void;
  onJointAxisChange?: (jointName: string, axis: [number, number, number]) => void;
  onJointOriginChange?: (
    jointName: string,
    xyz: [number, number, number],
    rpy: [number, number, number]
  ) => void;
  onResetAxis?: (jointName: string) => void;
  onJointTypeChange?: (jointName: string, jointType: string, lowerLimit?: number, upperLimit?: number) => void;
  onJointLimitsChange?: (
    jointName: string,
    lowerLimit?: number | null,
    upperLimit?: number | null
  ) => void;
  onJointVelocityChange?: (jointName: string, velocity: number | null) => void;
  onJointEffortChange?: (jointName: string, effort: number | null) => void;
  onJointNameChange?: (oldName: string, newName: string) => boolean | void;
  onDeleteJoint?: (jointName: string) => void;
  onJointLinkChange?: (jointName: string, parentLink: string, childLink: string) => void;
  // Link editing props
  meshFiles?: Record<string, Blob>;
  onMaterialChange?: (linkName: string, materialName: string, color: string) => void;
  onLinkNameChange?: (oldName: string, newName: string) => void;
  onUrdfChange?: (newContent: string) => void;
  collisionVisibility?: CollisionVisibility;
  onCollisionVisibilityChange?: (visibility: CollisionVisibility) => void;
  collisionSimplifyLinks?: string[];
  onCollisionSimplifyLinksChange?: (links: string[]) => void;
  collisionMergedLinks?: string[];
  onCollisionMergedLinksChange?: (links: string[]) => void;
  robot?: URDFRobot | null;
  endEffectorLink?: string | null;
  endEffectorCandidates?: string[];
  onMarkAsEndEffector?: (linkName: string | null) => void;
  onGenerateInertialDraft?: (linkName: string, densityPresetId: InertialDensityPresetId) => void;
  simulationPrepPanelOpen?: boolean;
  voxelDerivedInertialLinks?: string[];
}

type StructureViewMode = "links" | "flat" | "hierarchy";
type SidebarViewMode = StructureViewMode;

const STRUCTURE_MODE_OPTIONS: Array<{
  value: StructureViewMode;
  baseLabel: string;
  requiresUrdf?: boolean;
}> = [
  { value: "flat", baseLabel: "Joints" },
  { value: "links", baseLabel: "Links", requiresUrdf: true },
  { value: "hierarchy", baseLabel: "Hierarchy", requiresUrdf: true },
];

export const JointListSidebar = ({
  availableJoints,
  availableLinks = [],
  jointLimits,
  selectedJoint,
  selectedLink: selectedLinkProp,
  hoveredLink: hoveredLinkProp,
  onJointSelect,
  onLinkSelect,
  onJointHover,
  hoveredJoint,
  deletedJoints = new Set(),
  width = DEFAULT_RIGHT_SIDEBAR_WIDTH,
  isCollapsed = false,
  angleUnit: angleUnitProp,
  onAngleUnitChange: onAngleUnitChangeProp,
  urdfContent,
  urdfAnalysis,
  jointAxes = {},
  originalJointAxes = {},
  onJointChange,
  onJointAxisChange,
  onJointOriginChange,
  onResetAxis,
  onJointTypeChange,
  onJointLimitsChange,
  onJointVelocityChange,
  onJointEffortChange,
  onJointNameChange,
  onDeleteJoint,
  onJointLinkChange,
  meshFiles = {},
  onMaterialChange,
  onLinkNameChange,
  onUrdfChange,
  collisionVisibility = {},
  onCollisionVisibilityChange,
  collisionSimplifyLinks = [],
  onCollisionSimplifyLinksChange,
  collisionMergedLinks = [],
  onCollisionMergedLinksChange,
  robot,
  endEffectorLink,
  endEffectorCandidates = [],
  onMarkAsEndEffector,
  onGenerateInertialDraft,
  simulationPrepPanelOpen = false,
  voxelDerivedInertialLinks = [],
}: JointListSidebarProps) => {
  // Use prop if provided, otherwise default to "rad"
  const angleUnit = angleUnitProp ?? "rad";
  const onAngleUnitChange = onAngleUnitChangeProp ?? (() => {});

  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<SidebarViewMode>("flat");
  const [linkGroupingMode, setLinkGroupingMode] = useState<LinkSidebarGroupingMode>("body");
  const effectiveStructureViewMode: SidebarViewMode = viewMode;
  const [collapsedLinkSectionIds, setCollapsedLinkSectionIds] = useState<Set<string>>(new Set());
  const [collapsedJointSectionIds, setCollapsedJointSectionIds] = useState<Set<string>>(new Set());
  const knownLinkSectionIdsRef = useRef<Set<string>>(new Set());
  const knownJointSectionIdsRef = useRef<Set<string>>(new Set());
  const jointActivityStateRef = useRef(createInitialJointActivityState());
  const [activeMovingJointNames, setActiveMovingJointNames] = useState<Set<string>>(new Set());
  const liveJointValues = useJointStore((state) => state.jointValues);
  const liveJointValuesRef = useRef<Record<string, number>>({});
  const jointEffortLimits = useMemo(() => parseJointEffortLimits(urdfContent), [urdfContent]);

  // Use selectedLink from props instead of local state
  const selectedLink = selectedLinkProp ?? null;
  const hoveredLink = hoveredLinkProp ?? null;
  const setSelectedLink = useCallback((linkName: string | null) => {
    onLinkSelect?.(linkName);
  }, [onLinkSelect]);
  const [selectedBatchLinks, setSelectedBatchLinks] = useState<Set<string>>(new Set());
  const selectedBatchLinkNames = useMemo(
    () => Array.from(selectedBatchLinks).sort((lhs, rhs) => lhs.localeCompare(rhs)),
    [selectedBatchLinks]
  );
  const simplifiedLinkSet = useMemo(
    () => new Set(collisionSimplifyLinks),
    [collisionSimplifyLinks]
  );
  const mergedLinkSet = useMemo(
    () => new Set(collisionMergedLinks),
    [collisionMergedLinks]
  );
  const voxelDerivedInertialLinkSet = useMemo(
    () => new Set(voxelDerivedInertialLinks),
    [voxelDerivedInertialLinks]
  );
  const linkSidebarInteractionState = useMemo(
    () =>
      resolveLinkSidebarInteractionState({
        currentViewMode: viewMode as LinkSidebarViewMode,
        simulationPrepPanelOpen,
        selectedLink,
        hoveredLink,
      }),
    [hoveredLink, selectedLink, simulationPrepPanelOpen, viewMode]
  );
  const highlightedLinkName = linkSidebarInteractionState.highlightedLinkName;
  const analysis = useMemo(() => {
    if (urdfAnalysis) return urdfAnalysis;
    if (!urdfContent) return null;
    return analyzeUrdf(urdfContent);
  }, [urdfAnalysis, urdfContent]);
  const structureLabels = useMemo(
    () => buildRobotStructureLabels(analysis, urdfContent),
    [analysis, urdfContent]
  );
  const isAnalysisInvalid = urdfAnalysis?.isValid === false;
  const hasMultipleEndEffectors = endEffectorCandidates.length > 1;
  const panelRows = SIDEBAR_PANEL_LAYOUT.structureRows;
  const isSearchMode =
    effectiveStructureViewMode === "flat" ||
    effectiveStructureViewMode === "hierarchy" ||
    effectiveStructureViewMode === "links";
  const jointHierarchy = analysis?.jointHierarchy ?? null;
  const totalJointCount = useMemo(
    () => Object.keys(jointLimits).length,
    [jointLimits]
  );
  const allLinks = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.linkNames].sort();
  }, [analysis]);
  const structureModeOptions = useMemo(
    () =>
      STRUCTURE_MODE_OPTIONS.map((option) => {
        if (option.value === "flat") {
          return {
            ...option,
            label: `${option.baseLabel} (${totalJointCount})`,
          };
        }
        if (option.value === "links") {
          return {
            ...option,
            label: `${option.baseLabel} (${allLinks.length})`,
          };
        }
        return {
          ...option,
          label: option.baseLabel,
        };
      }),
    [allLinks.length, totalJointCount]
  );
  const colorJointNames = availableJoints;
  const effectiveEndEffectorLink = useMemo(
    () =>
      resolveEffectiveEndEffectorLink({
        explicitEndEffectorLink: endEffectorLink,
        endEffectorCandidates,
        availableLinks: allLinks,
      }),
    [allLinks, endEffectorCandidates, endEffectorLink]
  );
  const structureIdentityKey = useMemo(
    () => `${availableJoints.join("|")}::${allLinks.join("|")}::${linkGroupingMode}`,
    [allLinks, availableJoints, linkGroupingMode]
  );
  const previousStructureIdentityKeyRef = useRef<string | null>(null);
  const linksWithCollisionSet = useMemo(() => {
    if (!analysis?.isValid) return new Set<string>();
    const collisionLinkNames = Object.entries(analysis.collisionsByLink)
      .filter(([, collisions]) => collisions.length > 0)
      .map(([linkName]) => linkName);
    return new Set(collisionLinkNames);
  }, [analysis]);
  const selectedBatchCollisionLinkNames = useMemo(
    () => selectedBatchLinkNames.filter((linkName) => linksWithCollisionSet.has(linkName)),
    [linksWithCollisionSet, selectedBatchLinkNames]
  );
  const selectedBatchCollisionCount = selectedBatchCollisionLinkNames.length;
  const hasSelectedCollisionBatchLinks = selectedBatchCollisionCount > 0;
  const hasMultiSelectedCollisionBatchLinks =
    selectedBatchCollisionCount >= MIN_LINK_BATCH_SELECTION_FOR_EDITOR;
  const selectedBatchSimplifiedCount = useMemo(
    () =>
      selectedBatchCollisionLinkNames.filter((linkName) => simplifiedLinkSet.has(linkName)).length,
    [selectedBatchCollisionLinkNames, simplifiedLinkSet]
  );
  const selectedBatchMergedCount = useMemo(
    () => selectedBatchCollisionLinkNames.filter((linkName) => mergedLinkSet.has(linkName)).length,
    [selectedBatchCollisionLinkNames, mergedLinkSet]
  );
  const hasSelectedBatchLinks = selectedBatchLinkNames.length > 0;
  const hasMultiSelectedBatchLinks =
    selectedBatchLinkNames.length >= MIN_LINK_BATCH_SELECTION_FOR_EDITOR;
  const hasMixedBatchSimplifyState =
    hasMultiSelectedCollisionBatchLinks &&
    selectedBatchSimplifiedCount > 0 &&
    selectedBatchSimplifiedCount < selectedBatchCollisionCount;
  const hasMixedBatchMergeState =
    hasMultiSelectedCollisionBatchLinks &&
    selectedBatchMergedCount > 0 &&
    selectedBatchMergedCount < selectedBatchCollisionCount;

  const selectedObjectId = useObjectStore((state) => state.selectedObjectId);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const worldObjectCount = useObjectStore((state) => state.objects.length);
  const worldCameraCount = useCameraStore((state) => state.cameras.length);
  const [isWorldExpanded, setIsWorldExpanded] = useState(true);
  const [worldPanelHeight, setWorldPanelHeight] = useState(WORLD_PANEL_DEFAULT_HEIGHT);
  const worldPanelResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const structureListScrollRef = useRef<HTMLDivElement | null>(null);
  const editorTitle = useMemo(() => {
    if (hasMultiSelectedBatchLinks) {
      return `Link Batch Editor (${selectedBatchLinkNames.length})`;
    }
    if (selectedCameraId) return "Camera Editor";
    if (selectedJoint) return `Joint Editor (${selectedJoint})`;
    if (selectedLink) return `Link Editor (${selectedLink})`;
    if (selectedObjectId) return "Object Editor";
    return "No Selection";
  }, [
    hasMultiSelectedBatchLinks,
    selectedBatchLinkNames.length,
    selectedCameraId,
    selectedJoint,
    selectedLink,
    selectedObjectId,
  ]);
  const totalWorldItems = worldObjectCount + worldCameraCount;
  const visibilityJointSeed = useMemo(
    () => new Set(availableJoints),
    [availableJoints]
  );
  const [visibleJoints, setVisibleJoints] = useState<Set<string>>(visibilityJointSeed);

  // Reset visibility when the loaded URDF joint set changes.
  useEffect(() => {
    setVisibleJoints(new Set(visibilityJointSeed));
  }, [visibilityJointSeed]);
  const handleWorldPanelResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isWorldExpanded) return;
      event.preventDefault();
      event.stopPropagation();

      const startY = event.clientY;
      const startHeight = worldPanelHeight;
      worldPanelResizeRef.current = { startY, startHeight };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const session = worldPanelResizeRef.current;
        if (!session) return;
        const deltaY = moveEvent.clientY - session.startY;
        const nextHeight = Math.max(
          WORLD_PANEL_MIN_HEIGHT,
          Math.min(WORLD_PANEL_MAX_HEIGHT, session.startHeight + deltaY)
        );
        setWorldPanelHeight(nextHeight);
      };

      const handlePointerUp = () => {
        worldPanelResizeRef.current = null;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [isWorldExpanded, worldPanelHeight]
  );

  const handleVisibilityToggle = useCallback((jointName: string) => {
    const newVisible = toggleStringSetValue(visibleJoints, jointName);
    setVisibleJoints(newVisible);
  }, [visibleJoints]);
  const handleBatchLinkToggle = useCallback((linkName: string) => {
    setSelectedBatchLinks((prev) => toggleStringSetValue(prev, linkName));
  }, []);
  const toggleBatchLinkGroup = useCallback((linkNames: string[]) => {
    if (linkNames.length === 0) return;
    setSelectedBatchLinks((prev) => {
      const allSelected = linkNames.every((linkName) => prev.has(linkName));
      const next = new Set(prev);
      if (allSelected) {
        linkNames.forEach((linkName) => {
          next.delete(linkName);
        });
      } else {
        linkNames.forEach((linkName) => {
          next.add(linkName);
        });
      }
      return next;
    });
  }, []);
  const clearBatchLinkSelection = useCallback(() => {
    setSelectedBatchLinks(new Set());
  }, []);
  const clearCrossSelections = useCallback(() => {
    onJointSelect?.(null);
    setSelectedLink(null);
    useObjectStore.getState().setSelectedObject(null);
    useCameraStore.getState().selectCamera(null);
  }, [onJointSelect, setSelectedLink]);
  const selectSidebarLink = useCallback((linkName: string) => {
    setSelectedLink(linkName);
    onJointSelect?.(null);
    useObjectStore.getState().setSelectedObject(null);
    useCameraStore.getState().selectCamera(null);
  }, [onJointSelect, setSelectedLink]);
  const selectSidebarJoint = useCallback((jointName: string) => {
    onJointSelect?.(jointName);
    setSelectedLink(null);
    useObjectStore.getState().setSelectedObject(null);
    useCameraStore.getState().selectCamera(null);
  }, [onJointSelect, setSelectedLink]);
  const closeSidebarEditor = useCallback(() => {
    clearCrossSelections();
    clearBatchLinkSelection();
  }, [clearBatchLinkSelection, clearCrossSelections]);
  useEffect(() => {
    if (effectiveStructureViewMode !== "links" && selectedBatchLinks.size > 0) {
      clearBatchLinkSelection();
    }
  }, [clearBatchLinkSelection, effectiveStructureViewMode, selectedBatchLinks.size]);
  useEffect(() => {
    useLinkHighlightStore.getState().setHighlightedLinks(selectedBatchLinkNames);
  }, [selectedBatchLinkNames]);
  useEffect(
    () => () => {
      useLinkHighlightStore.getState().clearHighlightedLinks();
    },
    []
  );
  const applyBatchCollisionSimplify = useCallback(
    (simplify: boolean) => {
      if (!onCollisionSimplifyLinksChange || selectedBatchCollisionLinkNames.length === 0) {
        return;
      }
      const updated = applyCollisionSimplifyToSelectedLinks(
        collisionSimplifyLinks,
        selectedBatchCollisionLinkNames,
        simplify
      );
      onCollisionSimplifyLinksChange(updated);
    },
    [
      collisionSimplifyLinks,
      onCollisionSimplifyLinksChange,
      selectedBatchCollisionLinkNames,
    ]
  );
  const simplifySelectedBatchCollisions = useCallback(() => {
    applyBatchCollisionSimplify(true);
  }, [applyBatchCollisionSimplify]);
  const restoreSelectedBatchCollisionMeshes = useCallback(() => {
    applyBatchCollisionSimplify(false);
  }, [applyBatchCollisionSimplify]);
  const applyBatchCollisionMerge = useCallback(() => {
    if (
      !onCollisionMergedLinksChange ||
      selectedBatchCollisionLinkNames.length < MIN_LINK_BATCH_SELECTION_FOR_EDITOR
    ) {
      return;
    }
    onCollisionMergedLinksChange(replaceMergedCollisionLinks(selectedBatchCollisionLinkNames));
  }, [onCollisionMergedLinksChange, selectedBatchCollisionLinkNames]);
  const clearBatchCollisionMerge = useCallback(() => {
    if (!onCollisionMergedLinksChange || selectedBatchCollisionLinkNames.length === 0) {
      return;
    }
    onCollisionMergedLinksChange(
      removeMergedCollisionLinks(collisionMergedLinks, selectedBatchCollisionLinkNames)
    );
  }, [
    collisionMergedLinks,
    onCollisionMergedLinksChange,
    selectedBatchCollisionLinkNames,
  ]);
  const addMeshCollisionForLink = useCallback(
    (linkName: string) => {
      if (!urdfContent || !onUrdfChange || !analysis?.isValid) {
        return;
      }
      if (linksWithCollisionSet.has(linkName)) {
        return;
      }
      const linkData = analysis.linkDataByName[linkName];
      if (!linkData) {
        return;
      }
      const meshVisual = linkData.visuals.find(
        (visual) => visual.geometry.type === "mesh" && Boolean(visual.geometry.params.filename)
      );
      if (!meshVisual) {
        return;
      }
      const meshFilename = meshVisual.geometry.params.filename ?? "";
      const meshScale = meshVisual.geometry.params.scale ?? "1 1 1";
      const nextUrdf = addCollisionToLink(
        urdfContent,
        linkName,
        "mesh",
        {
          filename: meshFilename,
          scale: meshScale,
        },
        meshVisual.origin
      );
      if (nextUrdf !== urdfContent) {
        onUrdfChange(nextUrdf);
      }
    },
    [analysis, linksWithCollisionSet, onUrdfChange, urdfContent]
  );
  // Get all unique joint types
  const jointTypes = useMemo(() => buildJointTypes(jointLimits), [jointLimits]);
  useEffect(() => {
    if (selectedBatchLinks.size === 0) return;
    const availableLinksSet = new Set(allLinks);
    setSelectedBatchLinks((prev) => {
      const filtered = new Set(
        Array.from(prev).filter((linkName) => availableLinksSet.has(linkName))
      );
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [allLinks, selectedBatchLinks.size]);
  useEffect(() => {
    if (!onCollisionMergedLinksChange || collisionMergedLinks.length === 0) return;
    const availableLinksSet = new Set(
      allLinks.filter((linkName) => linksWithCollisionSet.has(linkName))
    );
    const filteredMergedLinks = collisionMergedLinks.filter((linkName) =>
      availableLinksSet.has(linkName)
    );
    if (filteredMergedLinks.length !== collisionMergedLinks.length) {
      onCollisionMergedLinksChange(filteredMergedLinks);
    }
  }, [allLinks, collisionMergedLinks, linksWithCollisionSet, onCollisionMergedLinksChange]);
  useEffect(() => {
    if (!onCollisionSimplifyLinksChange || collisionSimplifyLinks.length === 0) return;
    const availableLinksSet = new Set(
      allLinks.filter((linkName) => linksWithCollisionSet.has(linkName))
    );
    const filteredSimplifyLinks = collisionSimplifyLinks.filter((linkName) =>
      availableLinksSet.has(linkName)
    );
    if (filteredSimplifyLinks.length !== collisionSimplifyLinks.length) {
      onCollisionSimplifyLinksChange(filteredSimplifyLinks);
    }
  }, [
    allLinks,
    collisionSimplifyLinks,
    linksWithCollisionSet,
    onCollisionSimplifyLinksChange,
  ]);

  // Get selected link data
  const selectedLinkData = useMemo(() => {
    if (!selectedLink) return null;
    if (analysis?.isValid) {
      return analysis.linkDataByName[selectedLink] ?? null;
    }
    return null;
  }, [analysis, selectedLink]);

  // Filter links by search query
  const filteredLinks = useMemo(() => {
    return filterLinksForSidebar({
      allLinks,
      searchQuery: deferredSearchQuery,
      voxelDerivedInertialLinkSet,
      voxelOnly: false,
    });
  }, [allLinks, deferredSearchQuery, voxelDerivedInertialLinkSet]);
  useEffect(() => {
    const nextViewMode = linkSidebarInteractionState.viewMode;
    if (nextViewMode !== viewMode) {
      setViewMode(nextViewMode);
    }
  }, [linkSidebarInteractionState.viewMode, viewMode]);
  // Filter joints by search and type (flat view)
  const flatViewJointNames = availableJoints;
  // Use jointLimits as source of truth only in URDF-joints mode to keep fixed joints visible.
  const filteredJoints = useMemo(
    () =>
      buildFilteredJointNames({
        availableJoints: flatViewJointNames,
        jointLimits,
        typeFilter,
        searchQuery: deferredSearchQuery,
        includeJointLimitNames: true,
      }),
    [
      deferredSearchQuery,
      flatViewJointNames,
      jointLimits,
      typeFilter,
    ]
  );
  const trackedJointNamesForActivity = useMemo(
    () =>
      Array.from(
        new Set([...availableJoints, ...Object.keys(jointLimits)])
      ).sort(),
    [availableJoints, jointLimits]
  );
  const updateActiveMovingJointNames = useCallback(
    (nowMs: number) => {
      const nextActivityState = advanceJointActivityState({
        state: jointActivityStateRef.current,
        trackedJointNames: trackedJointNamesForActivity,
        currentJointValues: liveJointValuesRef.current,
        nowMs,
        changeEpsilonRad: JOINT_ACTIVITY_PARAMS.changeEpsilonRad,
        visibleHoldMs: JOINT_ACTIVITY_PARAMS.visibleHoldMs,
      });
      jointActivityStateRef.current = nextActivityState;
      const nextActiveJointNames = resolveActiveJointNameSet(
        nextActivityState.activeUntilByJointName,
        nowMs
      );
      setActiveMovingJointNames((previous) =>
        areStringSetsEqual(previous, nextActiveJointNames) ? previous : nextActiveJointNames
      );
    },
    [trackedJointNamesForActivity]
  );

  const {
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
  } = useStructureGroupEditor({
    analysis,
    urdfContent,
    onUrdfChange,
    structureLabels,
    viewMode: effectiveStructureViewMode,
    filteredLinks,
    filteredJoints,
  });
  const displayedLinkSections = useMemo(() => {
    if (linkGroupingMode === "mesh") {
      return buildMeshGroupedLinkSections({
        analysis,
        filteredLinks,
      });
    }
    if (linkGroupingMode === "alpha") {
      return buildAlphabeticalLinkSections(filteredLinks);
    }
    return groupedLinksWithCustom;
  }, [analysis, filteredLinks, groupedLinksWithCustom, linkGroupingMode]);
  const canReassignDisplayedLinkGroups =
    canReassignStructureGroups && linkGroupingMode === "body";
  const getDisplayedLinkSectionLabel = useCallback(
    (sectionLabel: string) =>
      linkGroupingMode === "body"
        ? toGroupDisplayLabel(sectionLabel)
        : sectionLabel,
    [linkGroupingMode]
  );
  useEffect(() => {
    if (previousStructureIdentityKeyRef.current === structureIdentityKey) {
      return;
    }
    previousStructureIdentityKeyRef.current = structureIdentityKey;
    knownLinkSectionIdsRef.current = new Set();
    knownJointSectionIdsRef.current = new Set();
    setCollapsedLinkSectionIds(new Set());
    setCollapsedJointSectionIds(new Set());
    jointActivityStateRef.current = createInitialJointActivityState();
    setActiveMovingJointNames(new Set());
  }, [structureIdentityKey]);
  useEffect(() => {
    if (effectiveStructureViewMode === "links" && linkGroupingMode !== "body" && isSubgroupCreatorOpen) {
      closeSubgroupCreator();
    }
  }, [
    closeSubgroupCreator,
    effectiveStructureViewMode,
    isSubgroupCreatorOpen,
    linkGroupingMode,
  ]);
  useEffect(() => {
    liveJointValuesRef.current = liveJointValues;
    const nowMs =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    updateActiveMovingJointNames(nowMs);
  }, [liveJointValues, updateActiveMovingJointNames]);
  useEffect(() => {
    if (activeMovingJointNames.size === 0) return;
    const intervalId = window.setInterval(() => {
      const nowMs =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      updateActiveMovingJointNames(nowMs);
    }, JOINT_ACTIVITY_PARAMS.pruneIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [activeMovingJointNames.size, updateActiveMovingJointNames]);
  const selectedFilteredLinkCount = useMemo(
    () => filteredLinks.filter((linkName) => selectedBatchLinks.has(linkName)).length,
    [filteredLinks, selectedBatchLinks]
  );
  const areAllFilteredLinksSelected =
    filteredLinks.length > 0 && selectedFilteredLinkCount === filteredLinks.length;
  useEffect(() => {
    setCollapsedLinkSectionIds((prev) => {
      const reconciled = reconcileCollapsedSectionIds({
        previousCollapsedSectionIds: prev,
        knownSectionIds: knownLinkSectionIdsRef.current,
        sections: displayedLinkSections,
        collapseNewSectionsByDefault: true,
        collapseAllSections: false,
      });
      knownLinkSectionIdsRef.current = reconciled.knownSectionIds;
      return areStringSetsEqual(prev, reconciled.collapsedSectionIds)
        ? prev
        : reconciled.collapsedSectionIds;
    });
  }, [displayedLinkSections]);
  useEffect(() => {
    setCollapsedLinkSectionIds((prev) => {
      const next = expandStructureSectionsContainingItem({
        previousCollapsedSectionIds: prev,
        sections: displayedLinkSections,
        itemName: highlightedLinkName,
      });
      return areStringSetsEqual(prev, next) ? prev : next;
    });
  }, [displayedLinkSections, highlightedLinkName]);
  useEffect(() => {
    if (effectiveStructureViewMode !== "flat") return;
    setCollapsedJointSectionIds((prev) => {
      const reconciled = reconcileCollapsedSectionIds({
        previousCollapsedSectionIds: prev,
        knownSectionIds: knownJointSectionIdsRef.current,
        sections: groupedJointsWithCustom,
        collapseNewSectionsByDefault: true,
        collapseAllSections: false,
      });
      knownJointSectionIdsRef.current = reconciled.knownSectionIds;
      return areStringSetsEqual(prev, reconciled.collapsedSectionIds)
        ? prev
        : reconciled.collapsedSectionIds;
    });
  }, [effectiveStructureViewMode, groupedJointsWithCustom]);
  const toggleLinkSectionCollapse = useCallback(
    (sectionId: string) => {
      setCollapsedLinkSectionIds((prev) => toggleStringSetValue(prev, sectionId));
    },
    []
  );
  const toggleJointSectionCollapse = useCallback(
    (sectionId: string) => {
      setCollapsedJointSectionIds((prev) => toggleStringSetValue(prev, sectionId));
    },
    []
  );

  // Build tree structure for hierarchy view (Link -> Joint -> Link -> Joint...)
  const hierarchyTree = useMemo(
    () =>
      effectiveStructureViewMode === "hierarchy"
        ? buildHierarchyTree({
            jointHierarchy,
            jointLimits,
            typeFilter,
            searchQuery: deferredSearchQuery,
          })
        : null,
    [
      deferredSearchQuery,
      effectiveStructureViewMode,
      jointHierarchy,
      jointLimits,
      typeFilter,
    ]
  );

  // Filter hierarchical joints (for backward compatibility)
  const filteredHierarchyJoints = useMemo(
    () =>
      buildFilteredHierarchyJoints({
        jointHierarchy,
        jointLimits,
        typeFilter,
        searchQuery: deferredSearchQuery,
      }),
    [deferredSearchQuery, jointHierarchy, jointLimits, typeFilter]
  );

  if (isCollapsed) {
    return null;
  }

  const toggleSelectAllFilteredLinks = () => {
    if (filteredLinks.length === 0) return;
    setSelectedBatchLinks((prev) => {
      if (areAllFilteredLinksSelected) {
        const next = new Set(prev);
        filteredLinks.forEach((linkName) => {
          next.delete(linkName);
        });
        return next;
      }
      const next = new Set(prev);
      filteredLinks.forEach((linkName) => {
        next.add(linkName);
      });
      return next;
    });
  };

  return (
    <div
      className="fixed right-0 z-30 h-screen bg-background/95 border-l border-border/35 flex flex-col backdrop-blur-sm"
      style={{
        width,
        top: TOP_NAV_HEIGHT,
        height: VIEWPORT_HEIGHT_WITH_TOP_NAV,
      }}
    >
      {/* Two equal square sections */}
      <div className="grid h-full min-h-0 gap-1 p-1" style={{ gridTemplateRows: panelRows }}>
        {/* Top Section: Joints */}
        <div className={SIDEBAR_SECTION_CLASS}>
          {/* Header */}
          <div className={cn(SIDEBAR_SECTION_HEADER_CLASS, "space-y-1")}>
            <div className="rounded-sm border border-border/25 bg-background/55 p-1">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-1 text-left"
                onClick={() => setIsWorldExpanded((current) => !current)}
              >
                <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {isWorldExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  World
                </span>
                <span className="text-[9px] text-muted-foreground">
                  {worldObjectCount} obj · {worldCameraCount} cam
                </span>
              </button>
              {isWorldExpanded ? (
                <div className="mt-1">
                  <div
                    className="overflow-y-auto pr-1 minimal-scrollbar"
                    style={{ height: worldPanelHeight }}
                  >
                    <WorldPanel
                      robot={robot}
                      endEffectorLink={effectiveEndEffectorLink}
                      onJointSelect={onJointSelect}
                      setSelectedLink={setSelectedLink}
                    />
                  </div>
                  <div
                    className="mt-1 h-1.5 cursor-row-resize rounded-sm bg-border/35 transition-colors hover:bg-border/60"
                    title="Drag to resize world panel"
                    onPointerDown={handleWorldPanelResizeStart}
                  />
                </div>
              ) : totalWorldItems === 0 ? (
                <div className="mt-0.5 text-[9px] text-muted-foreground/70">No world items.</div>
              ) : null}
            </div>

            <div className="flex items-center gap-1">
              {structureModeOptions.map((option) => {
                const isActive = effectiveStructureViewMode === option.value;
                const isDisabled = Boolean(option.requiresUrdf && !urdfContent);
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => {
                      if (isDisabled) return;
                      setViewMode(option.value);
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

          {/* Filters and Controls */}
          {isSearchMode && (
            <div className="flex-shrink-0 border-b border-border/20 bg-background/90 p-1">
              <div className="flex items-center gap-1">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                  <Input
                    type="text"
                    placeholder={
                      effectiveStructureViewMode === "links"
                        ? "Search links..."
                        : "Search joints..."
                    }
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-6 pl-6 pr-6 text-[11px] bg-muted/20 border-border/50"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {effectiveStructureViewMode === "flat" && (
                  <>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                      <SelectTrigger className="h-6 w-24 text-[11px] bg-muted/20 border-border/50">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="all" className="text-xs">All</SelectItem>
                        {jointTypes.map(type => (
                          <SelectItem key={type} value={type} className="text-xs capitalize">
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}

                {(effectiveStructureViewMode === "links" ||
                  effectiveStructureViewMode === "flat") && (
                  <button
                    type="button"
                    className={STRUCTURE_SUBGROUP_ACTION_BUTTON_CLASS}
                    onClick={openSubgroupCreator}
                    disabled={
                      !canReassignStructureGroups ||
                      (effectiveStructureViewMode === "links" && linkGroupingMode !== "body")
                    }
                    title={
                      !canReassignStructureGroups
                        ? "Group editing is unavailable"
                        : effectiveStructureViewMode === "links" && linkGroupingMode !== "body"
                          ? "Subgroups are only available in Body grouping"
                          : "Create an empty subgroup drop target"
                    }
                  >
                    <Plus className="h-3 w-3" />
                    <span>Subgroup</span>
                  </button>
                )}
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
                        onClick={() => setLinkGroupingMode(option.value)}
                        aria-pressed={isActive}
                        aria-label={`Group links by ${option.label}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {(effectiveStructureViewMode === "links" ||
                effectiveStructureViewMode === "flat") &&
              isSubgroupCreatorOpen ? (
                <div className="mt-1.5 flex items-center gap-1">
                  <Input
                    type="text"
                    value={subgroupDraftLabel}
                    onChange={(event) => setSubgroupDraftLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        createCustomSubgroup();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        closeSubgroupCreator();
                      }
                    }}
                    placeholder="New subgroup (e.g. arm1_gripper)"
                    className="h-6 text-[10px] bg-muted/20 border-border/50"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="h-6 rounded-sm border border-border/50 px-1.5 text-[10px] text-foreground hover:bg-muted/20"
                    onClick={createCustomSubgroup}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="h-6 rounded-sm border border-border/35 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={closeSubgroupCreator}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* Scrollable Joint List */}
          <div
            ref={structureListScrollRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-1 minimal-scrollbar"
            onDragOver={(event) => {
              handleStructureListDragOver(event, structureListScrollRef.current);
            }}
            onDrop={(event) => {
              handleStructureListDrop(event, structureListScrollRef.current);
            }}
          >
            {effectiveStructureViewMode === "links" ? (
              // Links view
              displayedLinkSections.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
                  {searchQuery
                    ? "No links match the search"
                    : "No links available"}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between rounded-sm border border-border/30 bg-muted/10 px-2 py-1">
                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-1.5 text-muted-foreground hover:text-foreground",
                        LINK_BROWSER_TEXT_CLASS
                      )}
                      onClick={toggleSelectAllFilteredLinks}
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
                    const sectionDisplayLabel = getDisplayedLinkSectionLabel(section.label);
                    const visibleLinkNames = isCollapsed
                      ? effectiveEndEffectorLink && section.items.includes(effectiveEndEffectorLink)
                        ? [effectiveEndEffectorLink]
                        : []
                      : section.items;
                    return (
                    <StructureSectionShell
                      key={section.id}
                      sectionLabel={section.label}
                      itemCount={section.items.length}
                      canReassignStructureGroups={canReassignDisplayedLinkGroups}
                      isStructureDragActive={isStructureDragActive}
                      activeStructureDropGroup={activeStructureDropGroup}
                      onDragOver={handleStructureGroupDragOver}
                      onDragLeave={handleStructureGroupDragLeave}
                      onDrop={handleStructureGroupDrop}
                      headerClassName={LINK_SECTION_HEADER_CLASS}
                      renderHeaderContent={() => (
                        <div className="flex min-w-0 items-center gap-1">
                          <button
                            type="button"
                            className={LINK_COLLAPSE_BUTTON_CLASS}
                            onClick={() => toggleLinkSectionCollapse(section.id)}
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
                              className={cn(
                                "h-3 w-3 transition-transform",
                                !isCollapsed && "rotate-90"
                              )}
                            />
                          </button>
                          <button
                            type="button"
                            className="flex min-w-0 items-center gap-1.5 text-left text-muted-foreground/85 hover:text-foreground"
                            onClick={() => toggleBatchLinkGroup(section.items)}
                            title={`Select all links in ${sectionDisplayLabel}`}
                          >
                            <BatchSelectionTick
                              selected={
                                section.items.length > 0 &&
                                section.items.every((linkName) => selectedBatchLinks.has(linkName))
                              }
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
                        const hasUrdfCollision = linksWithCollisionSet.has(linkName);
                        const isCollisionSimplified =
                          hasUrdfCollision && simplifiedLinkSet.has(linkName);
                        const isCollisionMerged = hasUrdfCollision && mergedLinkSet.has(linkName);
                        const hasEeStatus = effectiveEndEffectorLink === linkName;
                        const hasVoxelDerivedInertial = voxelDerivedInertialLinkSet.has(linkName);
                        const linkData = analysis?.isValid ? analysis.linkDataByName[linkName] : null;
                        const canAddMeshCollision =
                          !hasUrdfCollision &&
                          Boolean(
                            linkData?.visuals.some(
                              (visual) =>
                                visual.geometry.type === "mesh" &&
                                Boolean(visual.geometry.params.filename)
                            )
                          );
                        const statusSummaryLabel = [
                          isCollisionMerged ? "Mrg" : isCollisionSimplified ? "Simp" : null,
                          hasEeStatus ? "EE" : null,
                        ]
                          .filter((value): value is string => value !== null)
                          .join("+");
                        const statusSummaryTitle = [
                          isCollisionMerged
                            ? "Merged collision active"
                            : isCollisionSimplified
                              ? "Collision simplification enabled"
                              : null,
                          hasEeStatus ? "Marked as end effector" : null,
                        ]
                          .filter((value): value is string => value !== null)
                          .join(" • ");

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
                              handleStructureDragStart(event, {
                                sourceType: "link",
                                sourceName: linkName,
                                sourceGroupLabel: section.label,
                              })
                            }
                            onDragEnd={handleStructureDragEnd}
                            onClick={() => selectSidebarLink(linkName)}
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
                                handleBatchLinkToggle(linkName);
                                selectSidebarLink(linkName);
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
                                    addMeshCollisionForLink(linkName);
                                  }}
                                  title="Add mesh collision from visual geometry (manual)"
                                >
                                  Add Col
                                </button>
                              ) : null}
                              {statusSummaryLabel ? (
                                <span
                                  className={cn(
                                    LINK_STATUS_CHIP_CLASS,
                                    "border-cyan-500/40 bg-cyan-500/15 text-cyan-200"
                                  )}
                                  title={statusSummaryTitle}
                                >
                                  {statusSummaryLabel}
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
              )
            ) : effectiveStructureViewMode === "flat" ? (
              // Flat view
              groupedJointsWithCustom.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
                  {searchQuery || typeFilter !== "all"
                    ? "No joints match the filters"
                    : "No joints available"}
                </div>
              ) : (
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
                      onDragOver={handleStructureGroupDragOver}
                      onDragLeave={handleStructureGroupDragLeave}
                      onDrop={handleStructureGroupDrop}
                      headerClassName="flex items-center justify-between gap-2 px-1 text-[9px] uppercase tracking-[0.06em] text-muted-foreground/75"
                      renderHeaderContent={() => (
                        <button
                          type="button"
                          className="flex min-w-0 items-center gap-1 text-left text-muted-foreground/85 hover:text-foreground"
                          onClick={() => toggleJointSectionCollapse(section.id)}
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
                              handleStructureDragStart(event, {
                                sourceType: "joint",
                                sourceName: jointName,
                                sourceGroupLabel: section.label,
                              })
                            }
                            onDragEnd={handleStructureDragEnd}
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
                                  onValueChange={() => {}} // Read-only
                                  isDeleted={deletedJoints.has(jointName)}
                                  isSelected={selectedJoint === jointName}
                                  isHighlighted={hoveredJoint === jointName}
                                  angleUnit={angleUnit}
                                  onClick={() => selectSidebarJoint(jointName)}
                                  onHover={onJointHover}
                                  availableJoints={availableJoints}
                                  colorJointNames={colorJointNames}
                                  isVisible={visibleJoints.has(jointName)}
                                  onVisibilityToggle={handleVisibilityToggle}
                                  groupLabel={structureLabels.jointByName[jointName] ?? section.label ?? null}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                    </StructureSectionShell>
                    );
                  })}
                </div>
              )
            ) : (
              // Hierarchical view
              !hierarchyTree || filteredHierarchyJoints.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70 p-4 text-center">
                  {!hierarchyTree
                    ? "Loading hierarchy..."
                    : searchQuery || typeFilter !== "all"
                    ? "No joints match the filters"
                    : "No joints available"}
                </div>
              ) : (
                  <HierarchyTreeView
                    hierarchyTree={hierarchyTree}
                    jointLimits={jointLimits}
                    deletedJoints={deletedJoints}
                  selectedJoint={selectedJoint}
                  hoveredJoint={hoveredJoint}
                  angleUnit={angleUnit}
                  onJointSelect={onJointSelect}
                  onLinkSelect={selectSidebarLink}
                  selectedLink={selectedLink}
                  availableJoints={availableJoints}
                  colorJointNames={colorJointNames}
                  jointEffortLimits={jointEffortLimits}
                  visibleJoints={visibleJoints}
                  onVisibilityToggle={handleVisibilityToggle}
                  endEffectorLink={effectiveEndEffectorLink}
                  onMarkAsEndEffector={onMarkAsEndEffector}
                  structureLabels={structureLabels}
                />
              )
            )}
          </div>
        </div>

        {/* Bottom Section: General Editor */}
        <div className={SIDEBAR_SECTION_CLASS}>
          {/* Header */}
          <div className={SIDEBAR_SECTION_HEADER_CLASS}>
            <div className="flex items-center justify-between">
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.06em] text-foreground/90 truncate pr-2"
                title={editorTitle}
              >
                {editorTitle}
              </span>
              {(selectedJoint ||
                selectedLink ||
                selectedObjectId ||
                selectedCameraId ||
                hasSelectedBatchLinks) && (
                <button
                  onClick={closeSidebarEditor}
                  className="text-muted-foreground hover:text-foreground transition-colors rounded p-0.5 hover:bg-muted/40"
                  title="Close editor"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Editor Content */}
          <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden pr-1 blender-scrollbar [scrollbar-gutter:stable]">
            {isAnalysisInvalid ? (
              <div className="p-3 text-xs text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-sm m-2">
                <div className="font-medium mb-1">URDF is invalid</div>
                <div className="text-amber-100/80">
                  Fix the XML to re-enable joint and link editing.
                </div>
                {urdfAnalysis?.error && (
                  <div className="mt-2 text-[11px] text-amber-100/70 line-clamp-3">
                    {urdfAnalysis.error}
                  </div>
                )}
              </div>
            ) : hasMultiSelectedBatchLinks ? (
              <LinkBatchEditorPanel
                canClearMergedCollision={Boolean(
                  onCollisionMergedLinksChange && hasSelectedCollisionBatchLinks
                )}
                canMergeCollisions={Boolean(
                  onCollisionMergedLinksChange && hasMultiSelectedCollisionBatchLinks
                )}
                canSimplifyCollisions={Boolean(
                  onCollisionSimplifyLinksChange && hasSelectedCollisionBatchLinks
                )}
                hasMixedBatchMergeState={hasMixedBatchMergeState}
                hasMixedBatchSimplifyState={hasMixedBatchSimplifyState}
                hasSelectedCollisionBatchLinks={hasSelectedCollisionBatchLinks}
                mergedLinkSet={mergedLinkSet}
                onApplyCollisionMerge={applyBatchCollisionMerge}
                onClearCollisionMerge={clearBatchCollisionMerge}
                onClearSelection={clearBatchLinkSelection}
                onRestoreCollisionMeshes={restoreSelectedBatchCollisionMeshes}
                onSimplifyCollisions={simplifySelectedBatchCollisions}
                selectedBatchCollisionCount={selectedBatchCollisionCount}
                selectedBatchLinkNames={selectedBatchLinkNames}
                selectedBatchMergedCount={selectedBatchMergedCount}
                selectedBatchSimplifiedCount={selectedBatchSimplifiedCount}
                simplifiedLinkSet={simplifiedLinkSet}
              />
            ) : selectedCameraId ? (
              <CameraEditorPanel
                cameraId={selectedCameraId}
                availableJoints={availableJoints || []}
                robot={robot}
                urdfSensors={urdfAnalysis?.sensors ?? []}
              />
            ) : selectedJoint ? (
              <div 
                className="p-1"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <JointControl
                  jointName={selectedJoint}
                  jointInfo={jointLimits[selectedJoint]}
                  jointAxis={jointAxes[selectedJoint]}
                  originalAxis={originalJointAxes[selectedJoint]}
                  groupLabel={structureLabels.jointByName[selectedJoint] ?? null}
                  onValueChange={(value) => {
                    if (onJointChange && selectedJoint) {
                      onJointChange(selectedJoint, value);
                    }
                  }}
                  onAxisChange={onJointAxisChange}
                  onOriginChange={onJointOriginChange}
                  onResetAxis={onResetAxis}
                  onDeleteJoint={onDeleteJoint}
                  isDeleted={deletedJoints.has(selectedJoint)}
                  angleUnit={angleUnit}
                  onHover={onJointHover}
                  urdfContent={urdfContent}
                  urdfAnalysis={analysis}
                  isHighlighted={true}
                  onLinkChange={onJointLinkChange}
                  onTypeChange={onJointTypeChange ? (newType, lowerLimit, upperLimit) => {
                    onJointTypeChange(selectedJoint, newType, lowerLimit, upperLimit);
                  } : undefined}
                  onLimitsChange={onJointLimitsChange ? (lowerLimit, upperLimit) => {
                    onJointLimitsChange(selectedJoint, lowerLimit, upperLimit);
                  } : undefined}
                  onVelocityChange={onJointVelocityChange ? (velocity) => {
                    onJointVelocityChange(selectedJoint, velocity);
                  } : undefined}
                  onEffortChange={onJointEffortChange ? (effort) => {
                    onJointEffortChange(selectedJoint, effort);
                  } : undefined}
                  onNameChange={onJointNameChange}
                  alwaysExpanded={true}
                  hideValueDisplay={true}
                />
              </div>
            ) : selectedLink && selectedLinkData ? (
              <div 
                className="p-1"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <LinkControl
                  linkData={selectedLinkData}
                  urdfContent={urdfContent}
                  onMaterialChange={onMaterialChange}
                  onLinkNameChange={onLinkNameChange}
                  onUrdfChange={onUrdfChange}
                  meshFiles={meshFiles}
                  isHighlighted={true}
                  onSelect={() => {}}
                  collisionVisibility={collisionVisibility[selectedLink] || {}}
                  onCollisionVisibilityChange={(index, visible) => {
                    if (onCollisionVisibilityChange) {
                      const newVisibility = {
                        ...collisionVisibility,
                        [selectedLink]: {
                          ...(collisionVisibility[selectedLink] || {}),
                          [index]: visible,
                        },
                      };
                      onCollisionVisibilityChange(newVisibility);
                    }
                  }}
                  alwaysExpanded={true}
                  endEffectorLink={effectiveEndEffectorLink}
                  endEffectorCandidates={endEffectorCandidates}
                  analysisValid={analysis?.isValid === true}
                  onMarkAsEndEffector={onMarkAsEndEffector}
                  onGenerateInertialDraft={onGenerateInertialDraft}
                  voxelDerivedInertialLinks={voxelDerivedInertialLinks}
                />
                {hasMultipleEndEffectors && (
                  <div className="px-2 pb-2 text-[10px] text-muted-foreground/80">
                    Multiple end-effector candidates detected: {endEffectorCandidates.join(", ")}.
                  </div>
                )}
              </div>
            ) : selectedObjectId ? (
              <ObjectEditorPanel
                objectId={selectedObjectId}
                availableLinks={availableLinks || []}
                sidebarWidth={width}
                robot={robot}
                endEffectorLink={effectiveEndEffectorLink}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground/50 p-4 text-center">
                Select a joint, link, object, or camera to edit its properties
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
